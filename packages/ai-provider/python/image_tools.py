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


class LayerSegmentationError(ValueError):
    def __init__(self, name, message):
        super().__init__(message)
        self.name = name


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
    # 选区外紧邻区域确为同一纯色时直接延续该颜色，避免模型在纯色背景上生成淡淡的物体轮廓。
    ring = (cv2.dilate((mask > 0).astype(np.uint8), np.ones((7, 7), np.uint8)) > 0) & (mask == 0)
    if np.count_nonzero(ring) >= 64:
        surrounding = rgb[ring].astype(float)
        flat_color = np.median(surrounding, axis=0)
        if np.max(np.abs(surrounding - flat_color)) <= 1:
            output = rgb.copy()
            output[mask > 0] = np.rint(flat_color).astype(np.uint8)
            return output
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
    # 大面积缺失先用较粗的上下文补全，减少边缘细节被重复延伸成主体轮廓；小选区保留原精度。
    large_hole = np.count_nonzero(region_mask) > 65_536 and np.count_nonzero(region_mask) / region_mask.size > .2
    pixel_budget = 262_144 if large_hole else 1_000_000
    scale = min(1, math.sqrt(pixel_budget / (original_width * original_height)))
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
    # 蒙版已外扩覆盖笔画/物体，内侧三像素过渡只处理背景边缘；外部像素完全保留。
    blend = np.minimum(1, cv2.distanceTransform(selected.astype(np.uint8), cv2.DIST_L2, 3) / 3)[:, :, None]
    repaired = np.rint(restored * blend + rgb[top:bottom, left:right] * (1 - blend)).astype(np.uint8)
    output[top:bottom, left:right][selected] = repaired[selected]
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
        polygon = cv2.dilate(polygon, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
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
    margin = max(3, math.ceil(box_height * .12))
    transform = cv2.getPerspectiveTransform(quad.astype(np.float32), np.float32([[margin, margin], [box_width - 1 + margin, margin], [box_width - 1 + margin, box_height - 1 + margin], [margin, box_height - 1 + margin]]))
    straight = cv2.warpPerspective(strokes, transform, (box_width + margin * 2, box_height + margin * 2))
    rows, columns = np.where(straight > 100)
    if not len(rows):
        raise ValueError("文字方向无法可靠校正，请缩小处理范围后重试。")
    wide, tall = int(columns.max() - columns.min() + 1), int(rows.max() - rows.min() + 1)
    color = np.median(rgb[top:top + strokes.shape[0], left:left + strokes.shape[1]][strokes > 0], axis=0).astype(int)
    font_dir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    fonts = [("Microsoft YaHei", "msyh.ttc", "normal"), ("Microsoft YaHei", "msyhbd.ttc", "bold"), ("SimSun", "simsun.ttc", "normal"), ("SimHei", "simhei.ttf", "normal"), ("KaiTi", "simkai.ttf", "normal"), ("Arial", "arial.ttf", "normal"), ("Arial", "arialbd.ttf", "bold"), ("Arial", "ariali.ttf", "italic"), ("Arial", "arialbi.ttf", "bold italic"), ("Georgia", "georgia.ttf", "normal"), ("Georgia", "georgiab.ttf", "bold"), ("Georgia", "georgiai.ttf", "italic"), ("Times New Roman", "times.ttf", "normal"), ("Times New Roman", "timesbd.ttf", "bold"), ("Times New Roman", "timesi.ttf", "italic")]
    chinese_fonts = {"Microsoft YaHei", "SimSun", "SimHei", "KaiTi"}
    fonts += [(family, filename, 'bold italic' if style == 'bold' else 'italic') for family, filename, style in fonts if family in chinese_fonts]
    candidates = []
    target = straight[rows.min():rows.max() + 1, columns.min():columns.max() + 1] > 100
    has_chinese = any("\u3400" <= char <= "\u9fff" for char in text)
    italic_evidence = 0
    if has_chinese:
        # 中文竖笔画在消除合成倾斜后应明显变长；独立几何证据降低 OCR 漏空格对字型匹配的影响。
        vertical = np.ones((max(7, round(tall * .55)), 1), np.uint8)
        upright_strokes = np.count_nonzero(cv2.morphologyEx(target.astype(np.uint8), cv2.MORPH_OPEN, vertical))
        deskewed = cv2.warpAffine(target.astype(np.uint8) * 255, np.float32([[1, .25, 0], [0, 1, 0]]), (wide + math.ceil(tall * .25), tall)) > 100
        italic_strokes = np.count_nonzero(cv2.morphologyEx(deskewed.astype(np.uint8), cv2.MORPH_OPEN, vertical))
        ratio = italic_strokes / max(1, upright_strokes)
        if ratio >= 1.2 and italic_strokes - upright_strokes >= 16:
            italic_evidence = min(.2, (ratio - 1) * .4)
    # 字体仅在编辑器白名单内匹配；保留估算结果，不能声称恢复了原始字体源文件。
    for family, filename, style in fonts:
        path = font_dir / filename
        if not path.exists() or has_chinese and family in {"Arial", "Georgia", "Times New Roman"}:
            continue
        if not has_chinese and family in chinese_fonts and 'italic' in style:
            continue
        font = ImageFont.truetype(str(path), 100)
        bounds = font.getbbox(text)
        size = max(8, min(300, round(tall * 100 / max(1, bounds[3] - bounds[1]))))
        font = ImageFont.truetype(str(path), size)
        bounds = font.getbbox(text)
        sample = Image.new("L", (max(1, bounds[2] - bounds[0]), max(1, bounds[3] - bounds[1])))
        ImageDraw.Draw(sample).text((-bounds[0], -bounds[1]), text, fill=255, font=font)
        raster = np.asarray(sample)
        offset_x = 0
        if family in chinese_fonts and 'italic' in style:
            # 中文白名单字体没有斜体字库，用与浏览器合成斜体一致的约 14 度笔画倾斜参与匹配。
            ascent, _ = font.getmetrics()
            offset_x = max(0, math.ceil((bounds[3] - ascent) * .25))
            extra = max(0, math.ceil((ascent - bounds[1]) * .25))
            raster = cv2.warpAffine(raster, np.float32([[1, -.25, (ascent - bounds[1]) * .25 + offset_x], [0, 1, 0]]), (raster.shape[1] + offset_x + extra, raster.shape[0]))
        ink_rows, ink_columns = np.where(raster > 100)
        if not len(ink_rows):
            continue
        ink_left, ink_top = bounds[0] + int(ink_columns.min()) - offset_x, bounds[1] + int(ink_rows.min())
        raster = raster[ink_rows.min():ink_rows.max() + 1, ink_columns.min():ink_columns.max() + 1]
        fitted = cv2.resize(raster, (wide, tall)) > 100
        overlap = np.count_nonzero(fitted & target) / max(1, np.count_nonzero(fitted | target))
        # OCR 校正和缩放会产生位置误差，限制笔画面积偏差，避免粗字体仅因覆盖更多像素而胜出。
        overlap -= .25 * abs(math.log(max(1, np.count_nonzero(fitted)) / max(1, np.count_nonzero(target))))
        if family in chinese_fonts and 'italic' in style:
            overlap += italic_evidence
        spacing = (wide - raster.shape[1]) / max(1, len(text) - 1)
        if -20 <= spacing <= 100:
            candidates.append((overlap, family, size, spacing, filename, style, ink_left, ink_top))
    if not candidates:
        raise ValueError("未找到可用的编辑字体，请安装编辑器支持的字体。")
    # 合成斜体必须明显优于同族直立字型，避免普通中文因 OCR 几何误差被误判为斜体。
    candidates = [item for item in candidates if item[1] not in chinese_fonts or 'italic' not in item[5] or item[0] >= max((other[0] for other in candidates if other[1] == item[1] and other[5] == ('bold' if item[5] == 'bold italic' else 'normal')), default=-1) + .04]
    _, family, size, spacing, filename, style, ink_left, ink_top = max(candidates)
    angle = math.degrees(math.atan2(float(box[1][1] - box[0][1]), float(box[1][0] - box[0][0])))
    font = ImageFont.truetype(str(font_dir / filename), size)
    bounds = font.getbbox(text)
    ascent, descent = font.getmetrics()
    offset_y = (size - ascent - descent) / 2 + ink_top
    start = np.float32([[[float(columns.min()) - ink_left, float(rows.min()) - offset_y]]])
    origin = cv2.perspectiveTransform(start, np.linalg.inv(transform))[0, 0]
    x, y = max(0, float(origin[0]) + left), max(0, float(origin[1]) + top)
    layer = {"text": text, "x": round(x, 2), "y": round(y, 2), "width": min(width - x, wide + 4), "height": min(height - y, max(tall + 2, math.ceil(size * 1.25))), "rotation": angle, "fill": "#" + "".join(f"{channel:02x}" for channel in color), "align": "left", "fontFamily": family, "fontSize": size, "fontStyle": style, "letterSpacing": round(spacing, 2), "lineHeight": 1}
    # 仅笔画内核颜色符合单一线性变化时保存渐变；抗锯齿、纹理、花字不作为渐变依据。
    core = cv2.erode((straight > 200).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    core_rows, core_columns = np.where(core)
    if len(core_rows) >= 40:
        straight_rgb = cv2.warpPerspective(rgb[top:top + strokes.shape[0], left:left + strokes.shape[1]], transform, (straight.shape[1], straight.shape[0]))
        colors = straight_rgb[core].astype(float)
        coordinates = np.column_stack([np.ones(len(core_rows)), core_columns - start[0, 0, 0], core_rows - start[0, 0, 1]])
        coefficients, _, _, _ = np.linalg.lstsq(coordinates, colors, rcond=None)
        fitted = coordinates @ coefficients
        variance = np.sum((colors - colors.mean(axis=0)) ** 2)
        error = np.sum((colors - fitted) ** 2)
        directions, values, _ = np.linalg.svd(coefficients[1:], full_matrices=False)
        if variance > len(colors) * 100 and error / variance < .08 and np.abs(colors - fitted).mean() < 4 and values[1] < values[0] * .2:
            direction = directions[:, 0]
            if direction[np.argmax(np.abs(direction))] < 0:
                direction = -direction
            center = np.array([layer['width'], layer['height']]) / 2
            extent = (abs(direction[0]) * layer['width'] + abs(direction[1]) * layer['height']) / 2
            ends = [center - direction * extent, center + direction * extent]
            gradient_colors = [np.clip(np.rint(np.r_[1, point] @ coefficients), 0, 255).astype(int) for point in ends]
            if np.linalg.norm(gradient_colors[1] - gradient_colors[0]) >= 30:
                layer['fillGradient'] = {'colors': ['#' + ''.join(f'{channel:02x}' for channel in value) for value in gradient_colors], 'angle': round(math.degrees(math.atan2(direction[1], direction[0])) % 360, 2)}
    return layer


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


def foreground(rgba, models, validation_mask=None):
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
    # 整图抠图检查独立前背景；可靠 SAM 轮廓的拆层由相交覆盖率校验，允许显著性偏低时隔离邻物再细化一次。
    if validation_mask is None and (np.count_nonzero(alpha > .8) < rgba.shape[0] * rgba.shape[1] * .001 or np.count_nonzero(alpha < .1) < rgba.shape[0] * rgba.shape[1] * .01):
        raise ValueError("未能识别出独立前景，请调整图片范围后重试。")
    return np.rint(alpha * rgba[:, :, 3]).astype(np.uint8)


def object_mask(predictor, masks, scores, matte, region, context_bounds, minimum_confidence=.9):
    x, y, wide, tall = [region[key] for key in ("x", "y", "width", "height")]
    selected = int(np.argmax(scores))
    target = matte[y:y + tall, x:x + wide] > 100
    candidates = masks[:, y:y + tall, x:x + wide].astype(bool)
    intersections = np.count_nonzero(candidates & target, axis=(1, 2))
    unions = np.count_nonzero(candidates | target, axis=(1, 2))
    agreements = intersections / np.maximum(1, unions)
    best = int(np.argmax(agreements))
    left, top, right, bottom = x, y, x + wide, y + tall
    refined_body = False
    # SAM 高分可能仅指向容器边缘；只有另一个候选与独立前景模型明显一致，才修正漏掉商品内部的结果。
    incomplete = agreements[best] > .75 and agreements[best] - agreements[selected] > .2 and intersections[selected] / max(1, np.count_nonzero(target)) < .65
    if incomplete:
        selected = best
    # 高置信轮廓使用实际边界，语义框仅用于定位，避免略小的包围框把杯碟或商品边沿截断。
    if float(scores[selected]) >= minimum_confidence:
        left, top, right, bottom = context_bounds
    count, labels, stats, _ = cv2.connectedComponentsWithStats((matte > 100).astype(np.uint8))
    inside = np.bincount(labels[y:y + tall, x:x + wide].ravel(), minlength=count)
    inside[0] = 0
    component = int(np.argmax(inside))
    area = int(stats[component, cv2.CC_STAT_AREA]) if component else 0
    # 语义框用于定位；只有框内细化前景明确属于同一物体，才允许真实轮廓延展。横跨多个物体的近似框不猜主体。
    if area and inside[component] / max(1, np.count_nonzero(target)) > .9 and inside[component] / area > .4:
        body = labels == component
        overlap = np.count_nonzero(masks[selected].astype(bool) & body)
        original = overlap / max(1, np.count_nonzero(masks[selected].astype(bool) | body))
        if overlap / area > .9 and original > .75:
            left, top, right, bottom = context_bounds
        if incomplete or overlap / area < .9:
            a, b, c, d = stats[component, :4]
            refined, refined_scores, _ = predictor.predict(box=np.array([a, b, a + c, b + d]), multimask_output=True)
            agreement = np.count_nonzero(refined.astype(bool) & body, axis=(1, 2)) / np.maximum(1, np.count_nonzero(refined.astype(bool) | body, axis=(1, 2)))
            choice = int(np.argmax(agreement))
            if agreement[choice] > max(.75, original + .05) and float(refined_scores[choice]) > .85:
                masks, scores = refined, refined_scores
                selected = choice
                refined_body = True
                left, top, right, bottom = context_bounds
    mask = masks[selected].astype(np.uint8)
    clipped = np.zeros_like(mask)
    clipped[top:bottom, left:right] = mask[top:bottom, left:right]
    # 只补可靠轮廓内且前景模型认为不透明的孔洞；玻璃透射、杯柄空洞和外部环境仍由原蒙版决定。
    contours, _ = cv2.findContours(clipped, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(clipped)
    cv2.drawContours(filled, contours, -1, 1, cv2.FILLED)
    return np.maximum(clipped, filled & (matte > 200).astype(np.uint8)), float(scores[selected]), refined_body


def split(rgba, objects, models, directory):
    import torch
    from sam2.build_sam import build_sam2
    from sam2.sam2_image_predictor import SAM2ImagePredictor
    torch.set_num_threads(4)
    model = build_sam2("configs/sam2.1/sam2.1_hiera_t.yaml", str(models / "sam2.pt"), device="cpu", apply_postprocessing=False)
    predictor = SAM2ImagePredictor(model)
    detail_predictor = SAM2ImagePredictor(model)
    height, width = rgba.shape[:2]
    predictor.set_image(rgba[:, :, :3])
    occupied = np.zeros((height, width), np.uint8)
    removed = np.zeros((height, width), np.uint8)
    images = []
    # 收集全部不可靠范围后统一反馈；仍只允许业务层纠正一次，任何失败都不保存半份拆层结果。
    failures = []
    with torch.inference_mode():
        for index, region in enumerate(objects):
            try:
                x, y, wide, tall = [region[key] for key in ("x", "y", "width", "height")]
                # 每个元素带上下文单独细化，避免整图显著性蒙版只保留商品、丢掉独立装饰。
                context = max(64, min(128, round(min(wide, tall) * .2)))
                left, top = max(0, x - context), max(0, y - context)
                right, bottom = min(width, x + wide + context), min(height, y + tall + context)
                # 小元素在整图编码中只占少量像素，带上下文局部编码后映射回原坐标，保留其真实边沿细节。
                detailed = max(wide, tall) < min(width, height) * .12
                if detailed:
                    detail_predictor.set_image(rgba[top:bottom, left:right, :3])
                    local_masks, scores, _ = detail_predictor.predict(box=np.array([x - left, y - top, x + wide - left, y + tall - top]), multimask_output=True)
                    masks = np.zeros((len(local_masks), height, width), dtype=local_masks.dtype)
                    masks[:, top:bottom, left:right] = local_masks
                else:
                    masks, scores, _ = predictor.predict(box=np.array([x, y, x + wide, y + tall]), multimask_output=True)
                # 只有高置信 SAM 的实际物体形状可作为细化校验依据，不使用语义框矩形代替蒙版。
                validation_mask = None
                if float(np.max(scores)) >= .85:
                    validation_mask = np.zeros((bottom - top, right - left), np.uint8)
                    validation_mask[y - top:y + tall - top, x - left:x + wide - left] = masks[int(np.argmax(scores)), y:y + tall, x:x + wide]
                try:
                    matte = foreground(rgba[top:bottom, left:right], models, validation_mask)
                except ValueError as error:
                    raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素未能细化：{region['name']}。{error}") from error
                full_matte = np.zeros((height, width), np.uint8)
                full_matte[top:bottom, left:right] = matte
                if detailed:
                    local_region = {**region, "x": x - left, "y": y - top}
                    contour, confidence, refined_body = object_mask(detail_predictor, local_masks, scores, matte, local_region, (0, 0, right - left, bottom - top), minimum_confidence=.85)
                    seed = contour[y - top:y + tall - top, x - left:x + wide - left]
                    # 低置信轮廓贴着语义框时交给范围纠正，不能截成碎片后显示处理成功。
                    if confidence < .85 and (np.any(seed[:, 0]) and x > 0 or np.any(seed[:, -1]) and x + wide < width or np.any(seed[0]) and y > 0 or np.any(seed[-1]) and y + tall < height):
                        raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素边沿被范围截断：{region['name']}，请覆盖完整可见轮廓。")
                    # 即使模型分数高，框边长段透明截断而原图颜色连续，也不能冒充完整物体轮廓。
                    edges = []
                    if x > 0:
                        edges.append((seed[:, 0], contour[y - top:y + tall - top, x - left - 1], rgba[y:y + tall, x, :3], rgba[y:y + tall, x - 1, :3]))
                    if x + wide < width:
                        edges.append((seed[:, -1], contour[y - top:y + tall - top, x + wide - left], rgba[y:y + tall, x + wide - 1, :3], rgba[y:y + tall, x + wide, :3]))
                    if y > 0:
                        edges.append((seed[0], contour[y - top - 1, x - left:x + wide - left], rgba[y, x:x + wide, :3], rgba[y - 1, x:x + wide, :3]))
                    if y + tall < height:
                        edges.append((seed[-1], contour[y + tall - top, x - left:x + wide - left], rgba[y + tall - 1, x:x + wide, :3], rgba[y + tall, x:x + wide, :3]))
                    for inner, outer, inside_color, outside_color in edges:
                        cut = (inner > 0) & (outer == 0) & (np.max(np.abs(inside_color.astype(int) - outside_color.astype(int)), axis=1) < 10)
                        if np.count_nonzero(cut) > max(4, len(inner) * .2):
                            raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素在范围边缘被切断：{region['name']}，请扩大框覆盖完整可见物体。")
                    clipped = np.zeros((height, width), np.uint8)
                    clipped[top:bottom, left:right] = contour
                    # 一个小元素不能同时混入邻近物体；不把多个不相连的主体保存成一层碎片。
                    _, _, parts, _ = cv2.connectedComponentsWithStats(contour)
                    if np.count_nonzero(parts[1:, cv2.CC_STAT_AREA] > max(16, np.count_nonzero(contour) * .15)) > 1:
                        raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素包含多个不相连的物体：{region['name']}，请定位单个完整对象。")
                else:
                    clipped, confidence, refined_body = object_mask(predictor, masks, scores, full_matte, region, (left, top, right, bottom))
                coverage = np.count_nonzero((full_matte > 100) & (clipped > 0)) / max(1, np.count_nonzero(clipped))
                # 可靠轮廓已定位但显著性偏向局部时，隔离邻物后只细化一次；不可靠背景碎片不能据此伪装为物体。
                if (confidence >= (.85 if detailed else .9) and coverage < (.8 if detailed else .3)) or (refined_body and confidence > .85 and coverage < .9):
                    isolated = rgba[top:bottom, left:right].copy()
                    support = cv2.dilate(clipped[top:bottom, left:right], cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
                    isolated[support == 0, :3] = 245
                    try:
                        candidate = foreground(isolated, models, clipped[top:bottom, left:right])
                    except ValueError as error:
                        raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素未能可靠细化轮廓：{region['name']}。{error}") from error
                    candidate_coverage = np.count_nonzero((candidate > 100) & (clipped[top:bottom, left:right] > 0)) / max(1, np.count_nonzero(clipped))
                    if candidate_coverage > max(.8, coverage + .1):
                        matte = candidate
                        full_matte[top:bottom, left:right] = matte
                        coverage = candidate_coverage
                if coverage < .15:
                    raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素位置与真实轮廓不一致：{region['name']}，请重新定位。")
                # 补背景使用完整分割轮廓，不能按透明度阈值遗漏玻璃内部；透明图层仍保留细化后的 Alpha。
                removed = np.maximum(removed, clipped)
                alpha = np.zeros((height, width), np.uint8)
                alpha[top:bottom, left:right] = np.where(clipped[top:bottom, left:right] > 0, matte, 0)
                if np.count_nonzero(alpha > 100) < max(16, wide * tall * .005):
                    raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素未能可靠分离：{region['name']}，请调整图片范围后重试。")
                alpha = np.minimum(alpha, 255 - occupied)
                if np.count_nonzero(alpha > 100) < max(16, wide * tall * .005):
                    raise LayerSegmentationError(region["name"], f"第 {index + 1} 个元素与其他图层重合：{region['name']}，请重新定位。")
                occupied += alpha
                output = rgba.copy()
                output[:, :, 3] = alpha
                images.append((output, region["name"]))
            except LayerSegmentationError as error:
                failures.append(error)
            progress(round(25 + (index + 1) / len(objects) * 40))
    if failures:
        raise LayerSegmentationError(failures[0].name, "请重新定位以下元素：" + "；".join(str(error).split("：", 1)[0] + "：" + error.name[:12] for error in failures) + "。")
    padding = max(3, min(20, round(width * .012)))
    mask = cv2.dilate(np.maximum(removed, (occupied > 8).astype(np.uint8)) * 255, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (padding * 2 + 1, padding * 2 + 1)))
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
        try:
            images = split(rgba, objects, models, directory)
        except LayerSegmentationError as error:
            (directory / "failure.json").write_text(json.dumps({"code": "unreliable-layer", "name": error.name, "message": str(error)}, ensure_ascii=False), encoding="utf-8")
            raise
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
