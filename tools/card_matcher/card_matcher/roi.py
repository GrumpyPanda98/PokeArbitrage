from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .image_ops import write_bgr_image


@dataclass(frozen=True)
class RoiCrop:
    name: str
    image: np.ndarray
    box: tuple[int, int, int, int]


ROI_BOXES: dict[str, tuple[float, float, float, float]] = {
    "name": (0.08, 0.035, 0.72, 0.09),
    "collector_number": (0.54, 0.88, 0.40, 0.08),
    "set_symbol": (0.45, 0.84, 0.18, 0.12),
    "attack_text": (0.10, 0.54, 0.78, 0.20),
    "variant_surface": (0.08, 0.18, 0.84, 0.40),
}


def extract_rois(card_image: np.ndarray) -> dict[str, RoiCrop]:
    height, width = card_image.shape[:2]
    crops: dict[str, RoiCrop] = {}
    for name, box in ROI_BOXES.items():
        x, y, box_width, box_height = absolute_box(width, height, box)
        crops[name] = RoiCrop(
            name=name,
            image=card_image[y : y + box_height, x : x + box_width],
            box=(x, y, box_width, box_height),
        )
    return crops


def save_rois(card_image: np.ndarray, output_dir: str | Path, prefix: str = "roi") -> list[Path]:
    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for name, roi in extract_rois(card_image).items():
        path = destination / f"{prefix}-{name}.jpg"
        write_bgr_image(path, roi.image)
        paths.append(path)
    return paths


def absolute_box(
    width: int,
    height: int,
    relative_box: tuple[float, float, float, float],
) -> tuple[int, int, int, int]:
    x, y, box_width, box_height = relative_box
    left = max(0, min(width - 1, int(width * x)))
    top = max(0, min(height - 1, int(height * y)))
    right = max(left + 1, min(width, int(width * (x + box_width))))
    bottom = max(top + 1, min(height, int(height * (y + box_height))))
    return left, top, right - left, bottom - top
