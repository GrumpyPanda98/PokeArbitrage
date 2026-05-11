from __future__ import annotations

from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image


TARGET_SIZE = (420, 586)


def load_bgr_image(path: str | Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image: {path}")
    return image


def normalize_card_image(image: np.ndarray) -> tuple[np.ndarray, bool]:
    cropped = crop_card_contour(image)
    crop_used = cropped is not None
    working = cropped if cropped is not None else center_card_crop(image)
    normalized = cv2.resize(working, TARGET_SIZE, interpolation=cv2.INTER_AREA)
    return normalized, crop_used


def crop_card_contour(image: np.ndarray) -> np.ndarray | None:
    height, width = image.shape[:2]
    min_area = width * height * 0.18
    max_area = width * height * 0.96

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    edges = cv2.Canny(blurred, 45, 135)
    edges = cv2.dilate(edges, np.ones((3, 3), np.uint8), iterations=1)
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    candidates: list[tuple[float, np.ndarray]] = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area or area > max_area:
            continue

        perimeter = cv2.arcLength(contour, True)
        approx = cv2.approxPolyDP(contour, 0.035 * perimeter, True)
        rect = cv2.minAreaRect(contour)
        box = cv2.boxPoints(rect)
        if len(approx) >= 4:
            candidates.append((area, box.astype("float32")))

    if not candidates:
        return None

    _, points = max(candidates, key=lambda item: item[0])
    return four_point_transform(image, order_points(points))


def center_card_crop(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    target_ratio = TARGET_SIZE[0] / TARGET_SIZE[1]
    current_ratio = width / height

    if current_ratio > target_ratio:
        new_width = int(height * target_ratio)
        left = max((width - new_width) // 2, 0)
        return image[:, left : left + new_width]

    new_height = int(width / target_ratio)
    top = max((height - new_height) // 2, 0)
    return image[top : top + new_height, :]


def order_points(points: np.ndarray) -> np.ndarray:
    rect = np.zeros((4, 2), dtype="float32")
    summed = points.sum(axis=1)
    diff = np.diff(points, axis=1)
    rect[0] = points[np.argmin(summed)]
    rect[2] = points[np.argmax(summed)]
    rect[1] = points[np.argmin(diff)]
    rect[3] = points[np.argmax(diff)]
    return rect


def four_point_transform(image: np.ndarray, rect: np.ndarray) -> np.ndarray:
    top_left, top_right, bottom_right, bottom_left = rect
    width_a = np.linalg.norm(bottom_right - bottom_left)
    width_b = np.linalg.norm(top_right - top_left)
    max_width = max(int(width_a), int(width_b), 1)

    height_a = np.linalg.norm(top_right - bottom_right)
    height_b = np.linalg.norm(top_left - bottom_left)
    max_height = max(int(height_a), int(height_b), 1)

    destination = np.array(
        [
            [0, 0],
            [max_width - 1, 0],
            [max_width - 1, max_height - 1],
            [0, max_height - 1],
        ],
        dtype="float32",
    )
    matrix = cv2.getPerspectiveTransform(rect, destination)
    return cv2.warpPerspective(image, matrix, (max_width, max_height))


def perceptual_hashes(image: np.ndarray) -> tuple[str, str]:
    pil_image = Image.fromarray(cv2.cvtColor(image, cv2.COLOR_BGR2RGB))
    return str(imagehash.phash(pil_image)), str(imagehash.dhash(pil_image))


def hash_distance(left: str, right: str) -> int:
    return int(imagehash.hex_to_hash(left) - imagehash.hex_to_hash(right))


def color_histogram(image: np.ndarray) -> list[float]:
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    hist = cv2.calcHist([hsv], [0, 1, 2], None, [16, 8, 8], [0, 180, 0, 256, 0, 256])
    cv2.normalize(hist, hist)
    return hist.flatten().astype(float).tolist()


def histogram_similarity(left: list[float], right: list[float]) -> float:
    left_array = np.asarray(left, dtype=np.float32)
    right_array = np.asarray(right, dtype=np.float32)
    if left_array.size == 0 or right_array.size == 0:
        return 0.0
    score = cv2.compareHist(left_array, right_array, cv2.HISTCMP_CORREL)
    return float(max(0.0, min(1.0, (score + 1.0) / 2.0)))


def orb_similarity(query: np.ndarray, reference: np.ndarray) -> float:
    orb = cv2.ORB_create(nfeatures=1200, fastThreshold=8)
    query_gray = cv2.cvtColor(query, cv2.COLOR_BGR2GRAY)
    reference_gray = cv2.cvtColor(reference, cv2.COLOR_BGR2GRAY)
    keypoints_a, descriptors_a = orb.detectAndCompute(query_gray, None)
    keypoints_b, descriptors_b = orb.detectAndCompute(reference_gray, None)

    if descriptors_a is None or descriptors_b is None:
        return 0.0
    if len(keypoints_a) < 6 or len(keypoints_b) < 6:
        return 0.0

    matcher = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
    matches = sorted(matcher.match(descriptors_a, descriptors_b), key=lambda item: item.distance)
    if not matches:
        return 0.0

    good = [match for match in matches if match.distance <= 64]
    denominator = max(min(len(keypoints_a), len(keypoints_b)), 1)
    return float(max(0.0, min(1.0, len(good) / denominator * 4.0)))
