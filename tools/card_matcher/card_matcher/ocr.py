from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Iterable

import cv2
import numpy as np

from .identity import normalize_collector_number
from .roi import extract_rois


@dataclass(frozen=True)
class OcrField:
    text: str = ""
    confidence: float = 0.0


@dataclass(frozen=True)
class OcrFeatures:
    name: OcrField = field(default_factory=OcrField)
    collector_number: OcrField = field(default_factory=OcrField)
    attack_text: OcrField = field(default_factory=OcrField)
    language: OcrField = field(default_factory=OcrField)
    raw_text: str = ""

    def to_json(self) -> dict[str, object]:
        return {
            "name": field_json(self.name),
            "collector_number": field_json(self.collector_number),
            "attack_text": field_json(self.attack_text),
            "language": field_json(self.language),
            "raw_text": self.raw_text,
        }


class PaddleOcrReader:
    def __init__(self, languages: Iterable[str] = ("japan", "en")) -> None:
        try:
            from paddleocr import PaddleOCR
        except ImportError as error:
            raise RuntimeError("PaddleOCR is not installed in this Python environment.") from error

        self.readers = [
            PaddleOCR(use_angle_cls=True, lang=language, show_log=False)
            for language in languages
        ]

    def read_card(self, card_image: np.ndarray) -> OcrFeatures:
        rois = extract_rois(card_image)
        name = best_field(self.readers, rois["name"].image)
        number = normalize_number_field(best_field(self.readers, rois["collector_number"].image))
        attack = best_field(self.readers, rois["attack_text"].image)
        raw = "\n".join(
            item.text
            for item in [name, number, attack]
            if item.text
        )
        language = OcrField(text=infer_language(raw), confidence=0.8 if raw else 0.0)
        return OcrFeatures(
            name=name,
            collector_number=number,
            attack_text=attack,
            language=language,
            raw_text=raw,
        )


def best_field(readers: list[object], image: np.ndarray) -> OcrField:
    best = OcrField()
    prepared = prepare_ocr_image(image)
    for reader in readers:
        try:
            result = reader.ocr(prepared, cls=True)
        except Exception:
            continue
        for text, confidence in flatten_paddle_result(result):
            if confidence > best.confidence and text.strip():
                best = OcrField(text=text.strip(), confidence=float(confidence))
    return best


def prepare_ocr_image(image: np.ndarray) -> np.ndarray:
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    gray = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gray)
    return cv2.cvtColor(gray, cv2.COLOR_GRAY2BGR)


def flatten_paddle_result(result: object) -> list[tuple[str, float]]:
    rows: list[tuple[str, float]] = []
    if not isinstance(result, list):
        return rows

    for page in result:
        if not isinstance(page, list):
            continue
        for item in page:
            if (
                isinstance(item, list)
                and len(item) >= 2
                and isinstance(item[1], (tuple, list))
                and len(item[1]) >= 2
            ):
                rows.append((str(item[1][0]), float(item[1][1])))
    return rows


def normalize_number_field(field: OcrField) -> OcrField:
    if not field.text:
        return field
    match = re.search(r"[A-Z]*\d+[A-Z]?(/\d+)?", field.text.upper().replace("O", "0"))
    number = normalize_collector_number(match.group(0) if match else field.text)
    return OcrField(text=number, confidence=field.confidence)


def infer_language(text: str) -> str:
    if re.search(r"[\u3040-\u30ff\u3400-\u9fff]", text):
        return "ja"
    if text:
        return "en"
    return ""


def field_json(field: OcrField) -> dict[str, object]:
    return {"text": field.text, "confidence": round(field.confidence, 5)}
