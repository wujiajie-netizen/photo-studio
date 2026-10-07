"""Local OCR, segmentation and inpainting. All artifacts stay in the task directory."""
import argparse
import json
import math
import os
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont


def progress(value):
    print(json.dumps({"progress": value}), flush=True)


def ocr_engine(models):
    from rapidocr import RapidOCR, ModelType, OCRVersion
    return RapidOCR(params={
        "Global.log_level": "critical", "Global.text_score": 0.75,
        "Global.use_cls": False, "Global.max_side_len": 4096,
        "Det.ocr_version": OCRVersion.PPOCRV5, "Rec.ocr_version": OCRVersion.PPOCRV5,
        "Det.model_type": ModelType.MOBILE, "Rec.model_type": ModelType.MOBILE,
        "Det.limit_side_len": 1024,
        "Det.model_path": str(models / "ocr-det.onnx"),
        "Cls.model_path": str(models / "ocr-cls.onnx"),
        "Rec.model_path": str(models / "ocr-rec.onnx"),
        "EngineConfig.onnxruntime.intra_op_num_threads": 4,
        "EngineConfig.onnxruntime.inter_op_num_threads": 1,
    })


def repair(rgb, mask, models):
    if not np.any(mask):
        return rgb.copy()
    import torch
    torch.set_num_threads(4)
    model = torch.jit.load(str(models / "lama.pt"), map_location="cpu").eval()
    rows, columns = np.where(mask > 0)
    context = max(64, min(256, round(max(np.ptp(rows), np.ptp(columns)) * .3)))
    left, top = max(0, int(columns.min()) - context), max(0, int(rows.min()) - context)
    right, bottom = min(rgb.shape[1], int(columns.max()) + context + 1), min(rgb.shape[0], int(rows.max()) + context + 1)
    region, region_mask = rgb[top:bottom, left:right], mask[top:bottom, left:right]
    original_height, original_width = region.shape[:2]
    # 只对蒙版周围带上下文的区域推理；大图限制工作分辨率，原图的未选中像素始终逐像素保留。
    scale = min(1, math.sqrt(1_000_000 / (original_width * original_height)))
    width, height = max(1, round(original_width * scale)), max(1, round(original_height * scale))
    region = cv2.resize(region, (width, height), interpolation=cv2.INTER_AREA)
    region_mask = cv2.resize(region_mask, (width, height), interpolation=cv2.INTER_NEAREST)
    padded = np.pad(region, ((0, (-height) % 8), (0, (-width) % 8), (0, 0)), mode="reflect")
    padded_mask = np.pad(region_mask, ((0, (-height) % 8), (0, (-width) % 8)))
    image_tensor = torch.from_numpy(padded.astype(np.float32).transpose(2, 0, 1) / 255).unsqueeze(0)
    mask_tensor = torch.from_numpy((padded_mask > 0).astype(np.float32)).unsqueeze(0).unsqueeze(0)
    with torch.inference_mode():
        result = model(image_tensor, mask_tensor)[0].permute(1, 2, 0).numpy()
    restored = np.clip(result[:height, :width] * 255, 0, 255).astype(np.uint8)
    restored = cv2.resize(restored, (original_width, original_height), interpolation=cv2.INTER_CUBIC)
    output = rgb.copy()
    selected = mask[top:bottom, left:right] > 0
    output[top:bottom, left:right][selected] = restored[selected]
    return output


def text_mask(rgb, boxes):
    height, width = rgb.shape[:2]
    mask = np.zeros((height, width), np.uint8)
    glyphs = []
    for box in boxes:
        points = np.rint(box).astype(np.int32)
        x, y, wide, tall = cv2.boundingRect(points)
        padding = max(3, min(12, math.ceil(tall * .12)))
        left, top = max(0, x - padding), max(0, y - padding)
        right, bottom = min(width, x + wide + padding), min(height, y + tall + padding)
        roi = rgb[top:bottom, left:right]
        polygon = np.zeros(roi.shape[:2], np.uint8)
        cv2.fillPoly(polygon, [points - [left, top]], 255)
        # OCR 只负责文字行定位；局部颜色形态提取笔画，并扩张覆盖抗锯齿、描边和阴影。
        size = max(5, (tall // 2) * 2 + 1)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size))
        bright = cv2.morphologyEx(roi, cv2.MORPH_TOPHAT, kernel).max(axis=2)
        dark = cv2.morphologyEx(roi, cv2.MORPH_BLACKHAT, kernel).max(axis=2)
        candidates = []
        for response in (bright, dark):
            threshold, _ = cv2.threshold(response[polygon > 0].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
            strokes = ((response > max(8, threshold)) & (polygon > 0)).astype(np.uint8) * 255
            if np.count_nonzero(strokes) >= max(4, wide * tall * .015):
                candidates.append(strokes)
        if not candidates:
            raise ValueError("文字笔画与背景无法可靠分离，请缩小处理范围后重试。")
        strokes = min(candidates, key=np.count_nonzero)
        count, labels, stats, _ = cv2.connectedComponentsWithStats(strokes)
        keep = np.zeros_like(strokes)
        for index in range(1, count):
            if stats[index, cv2.CC_STAT_AREA] >= max(2, tall * .04):
                keep[labels == index] = 255
        if np.count_nonzero(keep) < max(4, wide * tall * .015):
            raise ValueError("文字笔画与背景无法可靠分离，请缩小处理范围或使用无痕改字。")
        glyphs.append((left, top, keep))
        expanded = cv2.dilate(keep, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (padding * 2 + 1, padding * 2 + 1)))
        mask[top:bottom, left:right] = np.maximum(mask[top:bottom, left:right], expanded)
    return mask, glyphs


def text_style(rgb, text, box, glyph):
    height, width = rgb.shape[:2]
    left, top, strokes = glyph
    # 先把倾斜文字行校正到水平，再估算字体；最后把文字起点映射回原图坐标。
    quad = np.asarray(box, dtype=np.float32) - [left, top]
    box_width = max(1, round(float(np.linalg.norm(quad[1] - quad[0]))))
    box_height = max(1, round(float(np.linalg.norm(quad[3] - quad[0]))))
    transform = cv2.getPerspectiveTransform(quad.astype(np.float32), np.float32([[0, 0], [box_width - 1, 0], [box_width - 1, box_height - 1], [0, box_height - 1]]))
    straight = cv2.warpPerspective(strokes, transform, (box_width, box_height))
    rows, columns = np.where(straight > 100)
    if not len(rows):
        raise ValueError("文字方向无法可靠校正，请缩小处理范围后重试。")
    wide, tall = int(columns.max() - columns.min() + 1), int(rows.max() - rows.min() + 1)
    color = np.median(rgb[top:top + strokes.shape[0], left:left + strokes.shape[1]][strokes > 0], axis=0).astype(int)
    font_dir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    fonts = [("Microsoft YaHei", "msyh.ttc"), ("SimSun", "simsun.ttc"), ("SimHei", "simhei.ttf"), ("KaiTi", "simkai.ttf"), ("Arial", "arial.ttf"), ("Georgia", "georgia.ttf"), ("Times New Roman", "times.ttf")]
    candidates = []
    target = straight[rows.min():rows.max() + 1, columns.min():columns.max() + 1] > 100
    has_chinese = any("\u3400" <= char <= "\u9fff" for char in text)
    # 字体仅在编辑器白名单内匹配；保留估算结果，不能声称恢复了原始字体源文件。
    for family, filename in fonts:
        path = font_dir / filename
        if not path.exists() or has_chinese and family in {"Arial", "Georgia", "Times New Roman"}:
            continue
        font = ImageFont.truetype(str(path), 100)
        bounds = font.getbbox(text)
        size = max(8, min(300, round(tall * 100 / max(1, bounds[3] - bounds[1]))))
        font = ImageFont.truetype(str(path), size)
        bounds = font.getbbox(text)
        sample = Image.new("L", (max(1, bounds[2] - bounds[0]), max(1, bounds[3] - bounds[1])))
        ImageDraw.Draw(sample).text((-bounds[0], -bounds[1]), text, fill=255, font=font)
        fitted = cv2.resize(np.asarray(sample), (wide, tall)) > 100
        overlap = np.count_nonzero(fitted & target) / max(1, np.count_nonzero(fitted | target))
        natural_width = float(font.getlength(text))
        spacing = (wide - natural_width) / max(1, len(text))
        if -20 <= spacing <= 100:
            candidates.append((overlap, family, size, spacing))
    if not candidates:
        raise ValueError("未找到可用的编辑字体，请安装编辑器支持的字体。")
    _, family, size, spacing = max(candidates)
    angle = math.degrees(math.atan2(float(box[1][1] - box[0][1]), float(box[1][0] - box[0][0])))
    filename = next(filename for name, filename in fonts if name == family)
    font = ImageFont.truetype(str(font_dir / filename), size)
    bounds = font.getbbox(text)
    ascent, descent = font.getmetrics()
    offset_y = (size - ascent - descent) / 2 + bounds[1]
    start = np.float32([[[float(columns.min()) - bounds[0], float(rows.min()) - offset_y]]])
    origin = cv2.perspectiveTransform(start, np.linalg.inv(transform))[0, 0]
    x, y = max(0, float(origin[0]) + left), max(0, float(origin[1]) + top)
    return {"text": text, "x": round(x, 2), "y": round(y, 2), "width": min(width - x, wide + 4), "height": min(height - y, max(tall + 2, math.ceil(size * 1.25))), "rotation": angle, "fill": "#" + "".join(f"{channel:02x}" for channel in color), "align": "left", "fontFamily": family, "fontSize": size, "fontStyle": "normal", "letterSpacing": round(spacing, 2), "lineHeight": 1}


def clean_text(rgba, models, directory, allow_empty):
    engine = ocr_engine(models)
    result = engine(cv2.cvtColor(rgba[:, :, :3], cv2.COLOR_RGB2BGR))
    if result.txts is None:
        if not allow_empty:
            raise ValueError("图片中未识别到文字，可以使用添加文字。")
        return rgba.copy(), []
    if len(result.txts) > 30 or any(score < .8 for score in result.scores):
        raise ValueError("文字识别数量过多或置信度不足，请缩小处理范围后重试。")
    mask, glyphs = text_mask(rgba[:, :, :3], result.boxes)
    Image.fromarray(mask).save(directory / "text-mask.png")
    text = [text_style(rgba[:, :, :3], value, box, glyph) for value, box, glyph in zip(result.txts, result.boxes, glyphs)]
    progress(30)
    output = rgba.copy()
    output[:, :, :3] = repair(rgba[:, :, :3], mask, models)
    progress(65)
    # 清字后再次识别原处理区；仍有可读残字就拒绝保存半份结果。
    check = engine(cv2.cvtColor(output[:, :, :3], cv2.COLOR_RGB2BGR))
    if check.boxes is not None:
        for box in check.boxes:
            x, y, wide, tall = cv2.boundingRect(np.rint(box).astype(np.int32))
            if np.any(mask[max(0, y):min(mask.shape[0], y + tall), max(0, x):min(mask.shape[1], x + wide)]):
                raise ValueError("清字后检测到文字残留，请调整处理范围后重试。")
    return output, text


def foreground(rgba, models):
    import onnxruntime as ort
    options = ort.SessionOptions()
    options.intra_op_num_threads = 4
    options.inter_op_num_threads = 1
    session = ort.InferenceSession(str(models / "birefnet.onnx"), sess_options=options, providers=["CPUExecutionProvider"])
    image_input = session.get_inputs()[0]
    size = int(image_input.shape[2])
    resized = cv2.resize(rgba[:, :, :3], (size, size), interpolation=cv2.INTER_LINEAR).astype(np.float32) / 255
    normalized = (resized - [.485, .456, .406]) / [.229, .224, .225]
    prediction = session.run(None, {image_input.name: normalized.transpose(2, 0, 1)[None].astype(np.float32)})[-1][0, 0]
    prediction = 1 / (1 + np.exp(-np.clip(prediction, -80, 80)))
    alpha = cv2.resize(prediction, (rgba.shape[1], rgba.shape[0]), interpolation=cv2.INTER_LINEAR)
    if np.count_nonzero(alpha > .8) < rgba.shape[0] * rgba.shape[1] * .001 or np.count_nonzero(alpha < .1) < rgba.shape[0] * rgba.shape[1] * .01:
        raise ValueError("未能识别出独立前景，请调整图片范围后重试。")
    return np.rint(alpha * rgba[:, :, 3]).astype(np.uint8)


def split(rgba, objects, models, directory):
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    torch.set_num_threads(4)
    model = build_sam2("configs/sam2.1/sam2.1_hiera_t.yaml", str(models / "sam2.pt"), device="cpu", apply_postprocessing=False)
    predictor = SAM2ImagePredictor(model)
    height, width = rgba.shape[:2]
    predictor.set_image(rgba[:, :, :3])
    occupied = np.zeros((height, width), np.uint8)
    images = []
    with torch.inference_mode():
        for index, region in enumerate(objects):
            x, y, wide, tall = [region[key] for key in ("x", "y", "width", "height")]
            masks, scores, _ = predictor.predict(box=np.array([x, y, x + wide, y + tall]), multimask_output=True)
            mask = masks[int(np.argmax(scores))].astype(np.uint8)
            # 每个元素带上下文单独细化，避免整图显著性蒙版只保留商品、丢掉独立装饰。
            clipped = np.zeros_like(mask)
            clipped[y:y + tall, x:x + wide] = mask[y:y + tall, x:x + wide]
            context = max(16, min(128, round(min(wide, tall) * .2)))
            left, top = max(0, x - context), max(0, y - context)
            right, bottom = min(width, x + wide + context), min(height, y + tall + context)
            matte = foreground(rgba[top:bottom, left:right], models)
            alpha = np.zeros((height, width), np.uint8)
            alpha[top:bottom, left:right] = np.where(clipped[top:bottom, left:right] > 0, matte, 0)
            if np.count_nonzero(alpha > 100) < max(16, wide * tall * .005):
                raise ValueError(f"未能可靠分离元素：{region['name']}，请调整图片范围后重试。")
            alpha = np.minimum(alpha, 255 - occupied)
            occupied += alpha
            output = rgba.copy()
            output[:, :, 3] = alpha
            images.append((output, region["name"]))
            progress(round(25 + (index + 1) / len(objects) * 40))
    padding = max(3, min(20, round(width * .012)))
    mask = cv2.dilate((occupied > 8).astype(np.uint8) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (padding * 2 + 1, padding * 2 + 1)))
    Image.fromarray(mask).save(directory / "foreground-mask.png")
    background = rgba.copy()
    background[:, :, :3] = repair(rgba[:, :, :3], mask, models)
    background[:, :, 3] = 255
    progress(90)
    return [(background, "背景"), *images]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime", required=True)
    parser.add_argument("--directory", required=True)
    args = parser.parse_args()
    directory = Path(args.directory).resolve(strict=True)
    models = Path(args.runtime).resolve(strict=True) / "models"
    input_data = json.loads((directory / "input.json").read_text(encoding="utf-8"))
    operation = input_data["operation"]
    if operation not in {"recognize-text", "prepare-layers", "cutout", "split-layers"}:
        raise ValueError("不支持的本地图片操作。")
    Image.MAX_IMAGE_PIXELS = 16_000_000
    rgba = np.array(Image.open(directory / "source.png").convert("RGBA"))
    height, width = rgba.shape[:2]
    if width * height > 16_000_000:
        raise ValueError("图片超过 1600 万像素。")
    progress(10)
    text = []
    if operation in {"recognize-text", "prepare-layers"}:
        image, text = clean_text(rgba, models, directory, operation == "prepare-layers")
        images = [(image, "背景")]
    elif operation == "cutout":
        image = rgba.copy()
        image[:, :, 3] = foreground(rgba, models)
        images = [(image, "主体")]
    else:
        objects = input_data["objects"]
        if not isinstance(objects, list) or not 1 <= len(objects) <= 8:
            raise ValueError("前景元素数量必须为 1 至 8 个。")
        for item in objects:
            if set(item) != {"name", "x", "y", "width", "height"} or not isinstance(item["name"], str) or not item["name"].strip() or len(item["name"]) > 100:
                raise ValueError("前景元素字段无效。")
            if any(type(item[key]) is not int for key in ("x", "y", "width", "height")) or item["x"] < 0 or item["y"] < 0 or item["width"] < 1 or item["height"] < 1 or item["x"] + item["width"] > width or item["y"] + item["height"] > height:
                raise ValueError("前景元素坐标无效。")
        images = split(rgba, objects, models, directory)
    for index, (image, _) in enumerate(images):
        Image.fromarray(image).save(directory / f"image-{index}.png")
    manifest = {"images": [{"name": name, "width": width, "height": height} for _, name in images], "text": text}
    (directory / "output.json").write_text(json.dumps(manifest, ensure_ascii=False), encoding="utf-8")
    progress(100)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
