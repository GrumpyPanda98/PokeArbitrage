from __future__ import annotations

import os
import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse


app = FastAPI(title="PokeArb Price OCR", version="0.1.0")

_OCR: Any | None = None
OCR_YEN_DIGIT = r"[0-9OoIl|SsB]"
SEPARATED_YEN_NUMBER = (
    rf"{OCR_YEN_DIGIT}{{1,3}}(?:\s*[,\.]\s*{OCR_YEN_DIGIT}{{3}})+"
)
SPACE_GROUPED_YEN_NUMBER = (
    rf"{OCR_YEN_DIGIT}{{1,3}}(?:\s+{OCR_YEN_DIGIT}{{3}})+"
)
LABELED_YEN_TOKEN = (
    rf"({SEPARATED_YEN_NUMBER}|{SPACE_GROUPED_YEN_NUMBER}|{OCR_YEN_DIGIT}{{3,7}})"
)
UNLABELED_YEN_TOKEN = (
    rf"({SEPARATED_YEN_NUMBER}|{SPACE_GROUPED_YEN_NUMBER}|{OCR_YEN_DIGIT}{{4,7}})"
)


def get_ocr() -> Any:
    global _OCR
    if _OCR is not None:
        return _OCR

    from paddleocr import PaddleOCR

    _OCR = PaddleOCR(
        device=os.getenv("POKEARB_PRICE_OCR_DEVICE", "gpu:0"),
        lang=os.getenv("POKEARB_PRICE_OCR_LANG", "japan"),
        text_detection_model_name=os.getenv(
            "POKEARB_PRICE_OCR_DET_MODEL", "PP-OCRv5_server_det"
        ),
        text_recognition_model_name=os.getenv(
            "POKEARB_PRICE_OCR_REC_MODEL", "PP-OCRv5_server_rec"
        ),
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False,
    )
    return _OCR


@app.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "source": "paddleocr-gpu"}


@app.post("/ocr-price")
async def ocr_price(file: UploadFile = File(...)) -> JSONResponse:
    suffix = Path(file.filename or "scan.jpg").suffix or ".jpg"
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp:
        temp.write(await file.read())
        image_path = temp.name

    try:
        text_lines = run_ocr(image_path)
        text = "\n".join(text_lines)
        prices = extract_yen_prices(text)
        return JSONResponse(
            {
                "prices": prices,
                "source": "paddleocr-gpu",
                "text": text,
                "yenPrice": prices[0] if prices else None,
            }
        )
    finally:
        try:
            os.remove(image_path)
        except OSError:
            pass


def run_ocr(image_path: str) -> list[str]:
    ocr = get_ocr()

    if hasattr(ocr, "predict"):
        result = ocr.predict(image_path)
    else:
        result = ocr.ocr(image_path, cls=False)

    return extract_text_lines(result)


def extract_text_lines(value: Any) -> list[str]:
    lines: list[str] = []

    def visit(node: Any) -> None:
        if node is None:
            return

        if isinstance(node, str):
            if node.strip():
                lines.append(node.strip())
            return

        if isinstance(node, dict):
            for key in ("rec_texts", "texts"):
                texts = node.get(key)
                if isinstance(texts, list):
                    for text in texts:
                        visit(text)

            for key in ("text", "description", "transcription"):
                visit(node.get(key))

            for value in node.values():
                if isinstance(value, (dict, list, tuple)):
                    visit(value)
            return

        json_value = getattr(node, "json", None)
        if isinstance(json_value, dict):
            visit(json_value)
            return

        if isinstance(node, (list, tuple)):
            # PaddleOCR 2.x shape: [box, (text, confidence)]
            if len(node) == 2 and isinstance(node[1], (list, tuple)) and node[1]:
                maybe_text = node[1][0]
                if isinstance(maybe_text, str):
                    visit(maybe_text)
                    return

            for item in node:
                visit(item)

    visit(value)
    return unique(lines)


def extract_yen_prices(text: str) -> list[int]:
    normalized = normalize_ocr_text(text)
    patterns = [
        re.compile(
            rf"(?:税込|税抜|特価|価格|値段|PRICE|JPY)\s*[:：]?\s*[¥Y]?\s*{LABELED_YEN_TOKEN}",
            re.I,
        ),
        re.compile(rf"[¥Y]\s*{LABELED_YEN_TOKEN}", re.I),
        re.compile(rf"{LABELED_YEN_TOKEN}\s*(?:円|YEN|JPY)", re.I),
        re.compile(rf"\b{UNLABELED_YEN_TOKEN}\b", re.I),
    ]

    values: list[int] = []
    for pattern in patterns:
        for match in pattern.finditer(normalized):
            value = parse_yen_token(match.group(1))
            if value is not None:
                values.append(value)

    return unique_numbers(values)


def normalize_ocr_text(text: str) -> str:
    return text.replace("￥", "¥").replace("，", ",")


def parse_yen_token(value: str) -> int | None:
    digits = (
        value.replace("O", "0")
        .replace("o", "0")
        .replace("I", "1")
        .replace("l", "1")
        .replace("|", "1")
        .replace("S", "5")
        .replace("s", "5")
        .replace("B", "8")
    )
    digits = re.sub(r"\D", "", digits)
    if len(digits) < 3:
        return None

    parsed = int(digits)
    if parsed < 100 or parsed > 10_000_000:
        return None

    return parsed


def unique(values: list[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def unique_numbers(values: list[int]) -> list[int]:
    seen: set[int] = set()
    result: list[int] = []
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result
