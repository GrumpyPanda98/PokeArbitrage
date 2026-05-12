from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

from .image_ops import card_contour_crops, order_points


@dataclass(frozen=True)
class CardDetection:
    label: str
    confidence: float
    polygon: list[tuple[float, float]]
    crop: np.ndarray


def detect_cards_opencv(image: np.ndarray, max_cards: int = 4) -> list[CardDetection]:
    crops = card_contour_crops(image, max_candidates=max_cards)
    detections: list[CardDetection] = []
    for index, crop in enumerate(crops, start=1):
        height, width = crop.shape[:2]
        detections.append(
            CardDetection(
                label=f"opencv-contour-{index}",
                confidence=0.5,
                polygon=[
                    (0.0, 0.0),
                    (float(width), 0.0),
                    (float(width), float(height)),
                    (0.0, float(height)),
                ],
                crop=crop,
            ),
        )
    return detections


def yolo_training_placeholder() -> str:
    return (
        "YOLO11 training is intentionally a data step, not a default runtime dependency. "
        "Export labeled real-photo detections first, then train a single-class card detector."
    )
