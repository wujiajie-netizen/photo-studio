"""Replay real split source + input.json without repeating semantic analysis or generation."""
import argparse
import importlib.util
import inspect
import json
import time
from pathlib import Path

import numpy as np
from PIL import Image


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--fixture', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--first-object', action='store_true', help='Diagnose the first foreground only; does not constitute full-scene acceptance.')
    parser.add_argument('--keep-diagnostics', action='store_true', help='Save intermediate diagnostic layers even if the full scene correctly fails; never a success manifest.')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[3]
    fixture = Path(args.fixture).resolve(strict=True)
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise ValueError('Use an empty acceptance directory.')
    input_data = json.loads((fixture / 'input.json').read_text(encoding='utf-8'))
    if input_data['operation'] != 'split-layers':
        raise ValueError('Fixture must contain the actual split-layers input.')
    objects = input_data['objects'][:1] if args.first_object else input_data['objects']
    rgba = np.array(Image.open(fixture / 'source.png').convert('RGBA'))
    Image.fromarray(rgba).save(output / 'source.png')
    (output / 'input.json').write_text(json.dumps({'operation': 'split-layers', 'objects': objects}, ensure_ascii=False), encoding='utf-8')
    spec = importlib.util.spec_from_file_location('worker', root / 'packages/ai-provider/python/image_tools.py')
    worker = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(worker)
    if args.keep_diagnostics:
        def diagnostic_progress(value):
            worker_progress(value)
            frame = inspect.currentframe().f_back
            if frame.f_code.co_name == 'split':
                for index, (image, _) in enumerate(frame.f_locals.get('images', [])):
                    Image.fromarray(image).save(output / f'diagnostic-layer-{index + 1}.png')
        worker_progress = worker.progress
        worker.progress = diagnostic_progress
    started = time.monotonic()
    try:
        layers = worker.split(rgba, objects, root / 'data/runtimes/image-tools/models', output)
    except worker.LayerSegmentationError as error:
        (output / 'failure.json').write_text(json.dumps({'code': 'unreliable-layer', 'name': error.name, 'message': str(error), 'seconds': round(time.monotonic() - started, 2)}, ensure_ascii=False, indent=2), encoding='utf-8')
        raise
    for index, (image, _) in enumerate(layers):
        Image.fromarray(image).save(output / f'image-{index}.png')
    mask = np.array(Image.open(output / 'foreground-mask.png')) > 0
    alpha = np.stack([image[:, :, 3].astype(int) for image, _ in layers[1:]])
    report = {
        'seconds': round(time.monotonic() - started, 2),
        'firstObjectOnly': args.first_object,
        'names': [name for _, name in layers],
        'foregroundPixels': [int((image > 100).sum()) for image in alpha],
        'excessAlphaPixels': int((alpha.sum(axis=0) > 255).sum()),
        'rgbChangedPixels': [int(np.any(image[:, :, :3] != rgba[:, :, :3], axis=2).sum()) for image, _ in layers[1:]],
        'outsideChangedPixels': int(np.any(layers[0][0] != rgba, axis=2)[~mask].sum()),
        'visualInspectionRequired': True,
    }
    (output / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False), flush=True)
    if report['excessAlphaPixels'] or report['outsideChangedPixels'] or any(report['rgbChangedPixels']):
        raise RuntimeError('Pixel invariants failed.')


if __name__ == '__main__':
    main()
