from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2
import imagehash
import numpy as np
from PIL import Image


TARGET_SIZE = (420, 586)
CARD_ASPECT_RATIO = TARGET_SIZE[0] / TARGET_SIZE[1]


@dataclass(frozen=True)
class NormalizedCardImage:
    image: np.ndarray
    crop_used: bool
    label: str


def load_bgr_image(path: str | Path) -> np.ndarray:
    image = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError(f"Could not read image: {path}")
    return image


def normalize_card_image(image: np.ndarray) -> tuple[np.ndarray, bool]:
    candidate = normalize_card_image_candidates(image, max_candidates=1)[0]
    return candidate.image, candidate.crop_used


def normalize_card_image_candidates(
    image: np.ndarray,
    max_candidates: int = 6,
) -> list[NormalizedCardImage]:
    candidates: list[NormalizedCardImage] = []

    for index, crop in enumerate(card_contour_crops(image, max_candidates=max_candidates - 1)):
        candidates.append(
            NormalizedCardImage(
                image=resize_card(orient_portrait(crop)),
                crop_used=True,
                label=f"contour-{index + 1}",
            ),
        )

    candidates.append(
        NormalizedCardImage(
            image=resize_card(center_card_crop(image)),
            crop_used=False,
            label="center",
        ),
    )

    candidates.append(
        NormalizedCardImage(
            image=resize_card(orient_portrait(image)),
            crop_used=False,
            label="full",
        ),
    )

    return dedupe_candidates(candidates)[:max_candidates]


def crop_card_contour(image: np.ndarray) -> np.ndarray | None:
    crops = card_contour_crops(image, max_candidates=1)
    return crops[0] if crops else None


def card_contour_crops(image: np.ndarray, max_candidates: int = 5) -> list[np.ndarray]:
    height, width = image.shape[:2]
    min_area = width * height * 0.12
    max_area = width * height * 0.96

    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    equalized = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    contour_images = []
    for source in (gray, equalized):
        blurred = cv2.GaussianBlur(source, (5, 5), 0)
        contour_images.append(cv2.Canny(blurred, 35, 120))
        contour_images.append(cv2.Canny(blurred, 65, 180))
        contour_images.append(cv2.adaptiveThreshold(
            blurred,
            255,
            cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
            cv2.THRESH_BINARY,
            31,
            5,
        ))

    kernel = np.ones((3, 3), np.uint8)
    candidates: list[tuple[float, np.ndarray]] = []
    for contour_image in contour_images:
        edges = cv2.dilate(contour_image, kernel, iterations=1)
        contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            area = cv2.contourArea(contour)
            if area < min_area or area > max_area:
                continue

            perimeter = cv2.arcLength(contour, True)
            approx = cv2.approxPolyDP(contour, 0.035 * perimeter, True)
            rect = cv2.minAreaRect(contour)
            rect_width, rect_height = rect[1]
            if rect_width <= 1 or rect_height <= 1:
                continue

            aspect = min(rect_width, rect_height) / max(rect_width, rect_height)
            aspect_error = abs(aspect - CARD_ASPECT_RATIO)
            if aspect < 0.48 or aspect > 0.9:
                continue

            box = cv2.boxPoints(rect).astype("float32")
            contour_bonus = 1.08 if len(approx) == 4 else 1.0
            score = area * contour_bonus * max(0.35, 1.0 - aspect_error)
            candidates.append((score, box))

    crops: list[np.ndarray] = []
    seen: set[tuple[int, int, int, int]] = set()
    for _, points in sorted(candidates, key=lambda item: item[0], reverse=True):
        key = bounding_key(points)
        if key in seen:
            continue

        seen.add(key)
        transformed = four_point_transform(image, order_points(points))
        if transformed.shape[0] < 80 or transformed.shape[1] < 60:
            continue
        crops.append(transformed)
        if len(crops) >= max_candidates:
            break

    return crops


def center_card_crop(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    target_ratio = CARD_ASPECT_RATIO
    current_ratio = width / height

    if current_ratio > target_ratio:
        new_width = int(height * target_ratio)
        left = max((width - new_width) // 2, 0)
        return image[:, left : left + new_width]

    new_height = int(width / target_ratio)
    top = max((height - new_height) // 2, 0)
    return image[top : top + new_height, :]


def orient_portrait(image: np.ndarray) -> np.ndarray:
    height, width = image.shape[:2]
    if width > height:
        return cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    return image


def resize_card(image: np.ndarray) -> np.ndarray:
    return cv2.resize(image, TARGET_SIZE, interpolation=cv2.INTER_AREA)


def dedupe_candidates(candidates: list[NormalizedCardImage]) -> list[NormalizedCardImage]:
    deduped: list[NormalizedCardImage] = []
    hashes: list[str] = []
    for candidate in candidates:
        phash, _ = perceptual_hashes(candidate.image)
        if any(hash_distance(phash, existing) <= 4 for existing in hashes):
            continue
        hashes.append(phash)
        deduped.append(candidate)
    return deduped


def bounding_key(points: np.ndarray) -> tuple[int, int, int, int]:
    x, y, width, height = cv2.boundingRect(points.astype(np.int32))
    bucket = 24
    return (
        round(x / bucket),
        round(y / bucket),
        round(width / bucket),
        round(height / bucket),
    )


def save_normalized_candidates(
    image: np.ndarray,
    output_dir: str | Path,
    prefix: str = "query",
) -> list[Path]:
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for index, candidate in enumerate(normalize_card_image_candidates(image), start=1):
        path = destination / f"{prefix}-{index:02d}-{candidate.label}.jpg"
        cv2.imwrite(str(path), candidate.image)
        paths.append(path)
    return paths


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
