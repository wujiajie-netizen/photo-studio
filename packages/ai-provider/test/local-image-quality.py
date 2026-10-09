"""Manual CPU model acceptance: python test/local-image-quality.py --output <isolated directory>."""
import argparse
import importlib.util
import json
import time
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    parser.add_argument('--browser-font-samples', help='Directory containing Chrome canvas normal/bold/italic/bold-italic PNG fixtures.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Use an empty acceptance directory to keep independent evidence.')
    spec = importlib.util.spec_from_file_location('worker', root / 'packages/ai-provider/python/image_tools.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    models = root / 'data/runtimes/image-tools/models'
    y, x = np.mgrid[:480, :640]
    background = np.stack([40 + x * .15, 60 + y * .18, 100 + x * .12], axis=2).astype(np.uint8)
    texture = np.clip(background.astype(float) + ((np.sin(x * .16) * np.cos(y * .12)) * 24)[:, :, None], 0, 255).astype(np.uint8)
    cases = []
    for name, base, label, face, style in [
        ('chinese', background, '\u65b0\u54c1\u4e0a\u5e02 \u9650\u65f6\u4f18\u60e0', 'msyh.ttc', 'normal'),
        ('chinese-bold', background, '\u65b0\u54c1\u4e0a\u5e02 \u9650\u65f6\u4f18\u60e0', 'msyhbd.ttc', 'bold'),
        ('english', background, 'Future Light', 'arial.ttf', 'normal'),
        ('texture', texture, 'COFFEE 2026', 'arial.ttf', 'normal'),
        ('bold', background, 'Future Light', 'arialbd.ttf', 'bold'),
        ('italic', background, 'Sale Today', 'ariali.ttf', 'italic'),
        ('bold-italic', background, 'Sale Today', 'arialbi.ttf', 'bold italic'),
        ('gradient', background, 'SUMMER SALE', 'arialbd.ttf', 'bold'),
        ('textured-ink', background, 'SUMMER SALE', 'arialbd.ttf', 'bold'),
        ('rotated', background, 'Sale Today', 'arial.ttf', 'normal')]:
        glyph = Image.new('L', (640, 480))
        ImageDraw.Draw(glyph).text((100, 80), label, font=ImageFont.truetype('C:/Windows/Fonts/' + face, 36), fill=255)
        if name == 'rotated':
            glyph = glyph.rotate(12, resample=Image.Resampling.BICUBIC)
        ink = np.array(glyph).astype(float) / 255
        color = np.full((480, 640, 3), 245, dtype=float)
        if name == 'gradient':
            color[:, :, 0] = 240
            color[:, :, 1] = 40 + x * .3
            color[:, :, 2] = 200 - x * .22
        if name == 'textured-ink':
            color[:, :, 0] = 240
            color[:, :, 1] = 100 + np.sin(x * .16) * 50
            color[:, :, 2] = 170 + np.cos(x * .16) * 40
        image = np.rint(base * (1 - ink[:, :, None]) + color * ink[:, :, None]).astype(np.uint8)
        cases.append((name, image, base, label, style, ink > .05))
    cases.append(('empty', background.copy(), background, '', None, np.zeros((480, 640), bool)))
    if args.browser_font_samples:
        for style in ['normal', 'bold', 'italic', 'bold italic']:
            rgb = np.array(Image.open(Path(args.browser_font_samples) / (style.replace(' ', '-') + '.png')).convert('RGB'))
            if rgb.shape != background.shape:
                raise ValueError('Browser font fixtures must be 640 x 480.')
            cases.append(('browser-chinese-' + style.replace(' ', '-'), rgb, background, '\u65b0\u54c1\u4e0a\u5e02 \u9650\u65f6\u4f18\u60e0', style, np.any(rgb != background, axis=2)))
    phone = root / 'data/runs/local-tools-check/phone/source.png'
    if phone.exists():
        cases.append(('phone', np.array(Image.open(phone).convert('RGB')), None, None, None, None))
    report = []
    panels = []
    for name, rgb, base, label, expected_style, known_ink in cases:
        directory = output / name
        directory.mkdir()
        rgba = np.dstack([rgb, np.full(rgb.shape[:2], 255, np.uint8)])
        Image.fromarray(rgba).save(directory / 'source.png')
        started = time.monotonic()
        item = {'sample': name, 'operation': 'recognize-text', 'expectedText': label, 'expectedFontStyle': expected_style}
        try:
            clean, text = worker.clean_text(rgba, models, directory, True)
            Image.fromarray(clean).save(directory / 'clean.png')
            (directory / 'text.json').write_text(json.dumps(text, ensure_ascii=False, indent=2), encoding='utf-8')
            mask = np.array(Image.open(directory / 'text-mask.png')) > 0 if (directory / 'text-mask.png').exists() else np.zeros(rgb.shape[:2], bool)
            item.update(text=[entry['text'] for entry in text], fontStyles=[entry['fontStyle'] for entry in text], gradients=[entry.get('fillGradient') for entry in text], outsideChangedPixels=int(np.any(clean != rgba, axis=2)[~mask].sum()))
            if base is not None:
                error = np.abs(clean[:, :, :3].astype(float) - base)
                item['maskMeanError'] = round(float(error[mask].mean()), 3) if mask.any() else 0
                item['unmaskedGlyphPixels'] = int((known_ink & ~mask).sum())
                item['glyphMeanError'] = round(float(error[known_ink].mean()), 3) if known_ink.any() else 0
            panels.append((name, rgba, clean))
        except Exception as error:
            item['error'] = str(error)
        item['seconds'] = round(time.monotonic() - started, 2)
        report.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    objects = [{'name': 'product', 'x': 145, 'y': 115, 'width': 180, 'height': 250}, {'name': 'decoration', 'x': 445, 'y': 225, 'width': 100, 'height': 100}]
    toy = Image.new('RGBA', (640, 480), '#b5c8e1')
    draw = ImageDraw.Draw(toy)
    draw.rounded_rectangle((150, 120, 320, 360), 20, fill='#de5050', outline='#333333', width=4)
    draw.ellipse((450, 230, 540, 320), fill='#f8d33b', outline='#444444', width=3)
    overlap = Image.new('RGBA', (640, 480), '#b5c8e1')
    draw = ImageDraw.Draw(overlap)
    draw.rounded_rectangle((150, 120, 330, 360), 20, fill='#de5050', outline='#333333', width=4)
    draw.ellipse((270, 210, 410, 350), fill='#f8d33b', outline='#444444', width=3)
    glass = Image.fromarray(background).convert('RGBA')
    shadow = Image.new('RGBA', glass.size)
    ImageDraw.Draw(shadow).ellipse((190, 345, 440, 390), fill=(0, 0, 0, 90))
    glass.alpha_composite(shadow.filter(ImageFilter.GaussianBlur(12)))
    glass_base = np.array(glass)
    bottle = Image.new('RGBA', glass.size)
    draw = ImageDraw.Draw(bottle)
    draw.rounded_rectangle((240, 150, 370, 365), 24, fill=(160, 220, 240, 65), outline=(240, 250, 255, 200), width=5)
    draw.rectangle((270, 105, 340, 155), fill=(200, 230, 240, 150), outline=(240, 250, 255, 200), width=4)
    draw.rectangle((262, 230, 347, 280), fill=(235, 225, 190, 255))
    glass.alpha_composite(bottle)
    split_cases = [('multi', toy, objects, None), ('overlap', overlap, [{'name': 'front', 'x': 265, 'y': 205, 'width': 150, 'height': 150}, {'name': 'rear', 'x': 145, 'y': 115, 'width': 190, 'height': 250}], None), ('transparent-shadow', glass, [{'name': 'glass', 'x': 235, 'y': 100, 'width': 140, 'height': 270}], glass_base)]
    phone_clean = output / 'phone/clean.png'
    if phone_clean.exists():
        split_cases.append(('split-phone', Image.open(phone_clean).convert('RGBA'), [{'name': 'rear', 'x': 102, 'y': 223, 'width': 230, 'height': 555}, {'name': 'front', 'x': 249, 'y': 232, 'width': 223, 'height': 550}], None))
    for name, image, regions, base in split_cases:
        directory = output / name
        directory.mkdir()
        image.save(directory / 'source.png')
        (directory / 'input.json').write_text(json.dumps({'operation': 'split-layers', 'objects': regions}), encoding='utf-8')
        rgba = np.array(image)
        started = time.monotonic()
        item = {'sample': name, 'operation': 'split-layers'}
        try:
            layers = worker.split(rgba, regions, models, directory)
            for index, (layer, _) in enumerate(layers):
                Image.fromarray(layer).save(directory / f'image-{index}.png')
            mask = np.array(Image.open(directory / 'foreground-mask.png')) > 0
            alpha = np.stack([layer[:, :, 3].astype(int) for layer, _ in layers[1:]])
            item.update(layers=len(layers), foregroundPixels=[int((layer > 100).sum()) for layer in alpha], excessAlphaPixels=int((alpha.sum(axis=0) > 255).sum()), rgbChangedPixels=[int(np.any(layer[:, :, :3] != rgba[:, :, :3], axis=2).sum()) for layer, _ in layers[1:]], outsideChangedPixels=int(np.any(layers[0][0] != rgba, axis=2)[~mask].sum()))
            jumps = []
            for axis in [0, 1]:
                edge = np.diff(mask.astype(int), axis=axis) != 0
                difference = np.abs(np.diff(layers[0][0][:, :, :3].astype(float), axis=axis)).mean(axis=2)
                jumps.append(round(float(difference[edge].mean()), 3))
            item['boundaryMeanJump'] = jumps
            if base is not None:
                item['backgroundMaskMeanError'] = round(float(np.abs(layers[0][0][:, :, :3].astype(float) - base[:, :, :3])[mask].mean()), 3)
                item['partialAlphaPixels'] = int(((alpha > 8) & (alpha < 247)).sum())
            panels.append((name, rgba, layers[0][0]))
        except Exception as error:
            item['error'] = str(error)
        item['seconds'] = round(time.monotonic() - started, 2)
        report.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    for name, image in [('cutout-multi', toy), ('cutout-transparent', glass), ('cutout-existing-alpha', toy.copy())]:
        directory = output / name
        directory.mkdir()
        rgba = np.array(image)
        if name == 'cutout-existing-alpha':
            rgba[:, :, 3] = np.rint(x / 639 * 255).astype(np.uint8)
        Image.fromarray(rgba).save(directory / 'source.png')
        started = time.monotonic()
        item = {'sample': name, 'operation': 'cutout'}
        try:
            alpha = worker.foreground(rgba, models)
            cutout = rgba.copy()
            cutout[:, :, 3] = alpha
            Image.fromarray(cutout).save(directory / 'cutout.png')
            item.update(rgbChangedPixels=int(np.any(cutout[:, :, :3] != rgba[:, :, :3], axis=2).sum()), increasedAlphaPixels=int((alpha > rgba[:, :, 3]).sum()), partialAlphaPixels=int(((alpha > 8) & (alpha < 247)).sum()), foregroundPixels=int((alpha > 100).sum()))
        except Exception as error:
            item['error'] = str(error)
        item['seconds'] = round(time.monotonic() - started, 2)
        report.append(item)
        print(json.dumps(item, ensure_ascii=False), flush=True)
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    comparison = Image.new('RGB', (640, 220 * len(panels)), 'white')
    for index, (name, source, clean) in enumerate(panels):
        for column, value in enumerate([source, clean]):
            preview = Image.fromarray(value).convert('RGB')
            preview.thumbnail((320, 195))
            comparison.paste(preview, (column * 320, index * 220 + 25))
        ImageDraw.Draw(comparison).text((5, index * 220 + 5), name + ' / source | processed', fill='black')
    comparison.save(output / 'comparison.jpg')
    failures = []
    for item in report:
        if item.get('error'):
            failures.append(item['sample'] + ': ' + item['error'])
        for invariant in ['outsideChangedPixels', 'excessAlphaPixels', 'increasedAlphaPixels', 'unmaskedGlyphPixels']:
            if item.get(invariant, 0) != 0:
                failures.append(item['sample'] + ': ' + invariant)
        rgb_changes = item.get('rgbChangedPixels', 0)
        if (any(rgb_changes) if isinstance(rgb_changes, list) else rgb_changes != 0):
            failures.append(item['sample'] + ': changed source RGB')
        if item.get('expectedText') is not None and ''.join(item.get('text', [])).replace(' ', '') != item['expectedText'].replace(' ', ''):
            failures.append(item['sample'] + ': text mismatch')
        if item.get('expectedFontStyle') is not None and item['fontStyles'] != [item['expectedFontStyle']]:
            failures.append(item['sample'] + ': font style mismatch')
        if item['sample'] == 'gradient' and not any(item['gradients']):
            failures.append('gradient: missing linear gradient')
        if item['sample'] == 'textured-ink' and any(item.get('gradients', [])):
            failures.append('textured-ink: false linear gradient')
    (output / 'checks.json').write_text(json.dumps({'failures': failures, 'visualInspectionRequired': True}, ensure_ascii=False, indent=2), encoding='utf-8')
    if failures:
        raise RuntimeError('; '.join(failures))


if __name__ == '__main__':
    main()
