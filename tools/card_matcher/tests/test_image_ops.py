from __future__ import annotations

import cv2
import numpy as np

from card_matcher.image_ops import (
    TARGET_SIZE,
    color_histogram,
    histogram_similarity,
    normalize_card_image,
    perceptual_hashes,
)


def test_normalize_card_image_uses_contour_crop_for_card_like_rectangle() -> None:
    image = np.zeros((800, 600, 3), dtype=np.uint8)
    points = np.array([[120, 70], [500, 115], [450, 740], [80, 690]], dtype=np.int32)
    cv2.fillConvexPoly(image, points, (240, 240, 240))
    cv2.rectangle(image, (185, 170), (395, 410), (40, 90, 180), -1)

    normalized, crop_used = normalize_card_image(image)

    assert crop_used is True
    assert normalized.shape[:2] == (TARGET_SIZE[1], TARGET_SIZE[0])


def test_hashes_and_histogram_are_stable_for_similar_images() -> None:
    image = np.full((586, 420, 3), (40, 120, 180), dtype=np.uint8)
    shifted = np.full((586, 420, 3), (43, 119, 181), dtype=np.uint8)

    phash, dhash = perceptual_hashes(image)
    shifted_phash, shifted_dhash = perceptual_hashes(shifted)
    assert phash
    assert dhash
    assert shifted_phash
    assert shifted_dhash

    score = histogram_similarity(color_histogram(image), color_histogram(shifted))
    assert score > 0.95
