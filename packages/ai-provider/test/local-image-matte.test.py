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

    def test_low_confidence_seed_uses_distributed_points_before_preserving_edges(self):
        matte = np.zeros((64, 64), np.uint8)
        matte[20:42, 20:42] = 255
        masks = np.stack([matte > 0, np.zeros_like(matte, bool), np.zeros_like(matte, bool)])
        region = {"x": 20, "y": 20, "width": 21, "height": 22}
        calls = []
        def predict(**kwargs):
            calls.append(kwargs)
            self.assertEqual(kwargs["point_labels"].tolist(), [1, 1, 1, 1])
            self.assertEqual(len(np.unique(kwargs["point_coords"], axis=0)), 4)
            return masks, np.array([.96, .7, .6]), None
        contour, confidence, refined = worker.object_mask(types.SimpleNamespace(predict=predict), masks, np.array([.6, .3, .2]), matte, region, (0, 0, 64, 64), minimum_confidence=.85, single_object=True)
        self.assertEqual(len(calls), 1)
        self.assertTrue(refined)
        self.assertEqual(confidence, .96)
        self.assertTrue(np.all(contour[20:42, 41] == 1))

    def test_low_confidence_background_is_not_extended(self):
        matte = np.zeros((64, 64), np.uint8)
        mask = np.zeros((64, 64), bool)
        mask[20:44, 20:44] = True
        region = {"x": 20, "y": 20, "width": 21, "height": 22}
        predictor = types.SimpleNamespace(predict=lambda **_: self.fail("No foreground to refine"))
        contour, _, refined = worker.object_mask(predictor, np.stack([mask, mask, mask]), np.array([.6, .3, .2]), matte, region, (0, 0, 64, 64), minimum_confidence=.85, single_object=True)
        self.assertFalse(refined)
        self.assertEqual(np.count_nonzero(contour[:, 41:]), 0)

    def test_fragment_points_exclude_the_neighbor_and_keep_full_body(self):
        mask = np.zeros((80, 80), bool)
        mask[20:40, 20:40] = True
        mask[12:17, 25:30] = True
        body = np.zeros_like(mask)
        body[20:45, 20:40] = True
        matte = (mask | body).astype(np.uint8) * 255
        region = {"x": 15, "y": 10, "width": 30, "height": 30}
        calls = []
        def predict(**kwargs):
            calls.append(kwargs)
            self.assertNotIn("box", kwargs)
            self.assertEqual(kwargs["point_labels"].tolist(), [1, 0])
            for point, label in zip(kwargs["point_coords"], kwargs["point_labels"]):
                self.assertEqual(bool(body[point[1], point[0]]), bool(label))
            return np.stack([body, body, body]), np.array([.96, .8, .7]), None
        contour, _, refined = worker.object_mask(types.SimpleNamespace(predict=predict), np.stack([mask, mask, mask]), np.array([.86, .7, .6]), matte, region, (0, 0, 80, 80), minimum_confidence=.85, single_object=True)
        self.assertEqual(len(calls), 1)
        self.assertTrue(refined)
        np.testing.assert_array_equal(contour, body.astype(np.uint8))

    def test_higher_score_cannot_override_a_neighbor_exclusion(self):
        mask = np.zeros((80, 80), bool)
        mask[20:40, 20:40] = True
        mask[12:17, 25:30] = True
        matte = mask.astype(np.uint8) * 255
        region = {"x": 15, "y": 10, "width": 30, "height": 30}
        predictor = types.SimpleNamespace(predict=lambda **_: (np.stack([mask, mask, mask]), np.array([.99, .98, .97]), None))
        _, confidence, refined = worker.object_mask(predictor, np.stack([mask, mask, mask]), np.array([.86, .7, .6]), matte, region, (0, 0, 80, 80), minimum_confidence=.85, single_object=True)
        self.assertFalse(refined)
        self.assertEqual(confidence, .86)

    def test_confident_but_truncated_mask_must_pass_geometry_after_refinement(self):
        body = np.zeros((80, 80), bool)
        body[20:50, 20:50] = True
        clipped = body.copy()
        clipped[42:] = False
        matte = body.astype(np.uint8) * 255
        rgb = np.repeat(matte[:, :, None], 3, axis=2)
        region = {"x": 20, "y": 20, "width": 30, "height": 22}
        self.assertTrue(worker.truncated_contour(clipped, rgb, region))
        self.assertFalse(worker.truncated_contour(body, rgb, region))
        predictor = types.SimpleNamespace(predict=lambda **_: (np.stack([body, body, body]), np.array([.91, .89, .88]), None))
        contour, confidence, refined = worker.object_mask(predictor, np.stack([clipped, clipped, clipped]), np.array([.97, .95, .93]), matte, region, (0, 0, 80, 80), minimum_confidence=.85, single_object=True, rgb=rgb)
        self.assertTrue(refined)
        self.assertEqual(confidence, .91)
        np.testing.assert_array_equal(contour, body.astype(np.uint8))

    def test_neighbor_outside_the_seed_cannot_replace_a_confident_object(self):
        body = np.zeros((80, 80), bool)
        body[20:40, 20:40] = True
        combined = body.copy()
        combined[40:60, 20:40] = True
        matte = combined.astype(np.uint8) * 255
        masks = np.stack([combined, body, np.zeros_like(body)])
        region = {"x": 15, "y": 15, "width": 30, "height": 38}
        predictor = types.SimpleNamespace(predict=lambda **_: (np.stack([combined, combined, combined]), np.array([.7, .6, .5]), None))
        for single_object in [False, True]:
            with self.subTest(single_object=single_object):
                contour, confidence, refined = worker.object_mask(predictor, masks, np.array([.55, .95, .1]), matte, region, (0, 0, 80, 80), minimum_confidence=.85, single_object=single_object)
                self.assertEqual(confidence, .95)
                self.assertFalse(refined)
                np.testing.assert_array_equal(contour, body.astype(np.uint8))

    def test_supported_body_inside_the_seed_can_restore_a_container_interior(self):
        body = np.zeros((80, 80), bool)
        body[20:60, 20:60] = True
        rim = body.copy()
        rim[24:56, 24:56] = False
        matte = body.astype(np.uint8) * 255
        masks = np.stack([body, rim, np.zeros_like(body)])
        predictor = types.SimpleNamespace(predict=lambda **_: (masks, np.array([.86, .95, .1]), None))
        contour, confidence, _ = worker.object_mask(predictor, masks, np.array([.86, .95, .1]), matte, {"x": 15, "y": 15, "width": 50, "height": 50}, (0, 0, 80, 80))
        self.assertEqual(confidence, .86)
        np.testing.assert_array_equal(contour, body.astype(np.uint8))


if __name__ == "__main__":
    unittest.main()
