"""Regression: a low initial matte may be refined, while cutout still rejects uniform predictions."""
import importlib.util
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch

import numpy as np


spec = importlib.util.spec_from_file_location("worker", Path(__file__).resolve().parents[1] / "python/image_tools.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class MatteValidationTest(unittest.TestCase):
    def prediction(self, logit):
        session = types.SimpleNamespace(
            get_inputs=lambda: [types.SimpleNamespace(name="image", shape=[1, 3, 8, 8])],
            run=lambda *_: [np.full((1, 1, 8, 8), logit, np.float32)],
        )
        return types.SimpleNamespace(SessionOptions=types.SimpleNamespace, InferenceSession=lambda *_args, **_kwargs: session)

    def test_cutout_rejects_uniform_foreground_and_background(self):
        source = np.full((32, 32, 4), 255, np.uint8)
        for logit in [-20, 20]:
            with self.subTest(logit=logit), patch.dict(sys.modules, {"onnxruntime": self.prediction(logit)}):
                with self.assertRaises(ValueError):
                    worker.foreground(source, Path("unused-models"))

    def test_trusted_contour_can_reach_the_isolated_refinement(self):
        source = np.full((32, 32, 4), 255, np.uint8)
        contour = np.zeros((32, 32), np.uint8)
        contour[8:24, 8:24] = 1
        with patch.dict(sys.modules, {"onnxruntime": self.prediction(-20)}):
            initial = worker.foreground(source, Path("unused-models"), contour)
        self.assertEqual(np.count_nonzero(initial), 0)
        with patch.dict(sys.modules, {"onnxruntime": self.prediction(20)}):
            refined = worker.foreground(source, Path("unused-models"), contour)
        self.assertEqual(int(refined[16, 16]), 255)

    def test_refined_alpha_preserves_existing_transparency(self):
        source = np.full((32, 32, 4), 255, np.uint8)
        source[:, :, 3] = 80
        contour = np.ones((32, 32), np.uint8)
        with patch.dict(sys.modules, {"onnxruntime": self.prediction(20)}):
            refined = worker.foreground(source, Path("unused-models"), contour)
        self.assertTrue(np.all(refined == 80))

    def test_confident_contour_is_not_cut_at_the_semantic_seed_box(self):
        matte = np.zeros((64, 64), np.uint8)
        matte[8:56, 8:56] = 255
        masks = np.stack([matte > 0, np.zeros_like(matte, bool), np.zeros_like(matte, bool)])
        region = {"x": 20, "y": 20, "width": 12, "height": 12}
        predictor = types.SimpleNamespace(predict=lambda **_: self.fail("A complete contour must not need refinement"))
        contour, confidence, _ = worker.object_mask(predictor, masks, np.array([.95, .3, .2]), matte, region, (0, 0, 64, 64))
        self.assertEqual(np.count_nonzero(contour), 48 * 48)
        self.assertEqual(confidence, .95)


if __name__ == "__main__":
    unittest.main()
