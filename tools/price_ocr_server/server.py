from __future__ import annotations

import os
import re
import tempfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, UploadFile
from fastapi.responses import JSONResponse
from PIL import Image


app = FastAPI(title="PokeArb Price OCR", version="0.2.0")

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


@dataclass
class OcrRegion:
    label: str
    path: str
    bbox: tuple[int, int, int, int] | None = None
    temporary: bool = False


@dataclass
class OcrItem:
    text: str
    confidence: float | None
    box: tuple[int, int, int, int] | None
    region: str


@dataclass
class ParsedYenCandidate:
    value: int
    score_bonus: float


@dataclass
class PriceCandidate:
    value: int
    score: float
    text: str
    region: str
    confidence: float | None
    box: tuple[int, int, int, int] | None


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

    regions: list[OcrRegion] = []
    try:
        regions = build_ocr_regions(image_path)
        items: list[OcrItem] = []
        for region in regions:
            items.extend(run_ocr_items(region))

        items = unique_ocr_items(items)
        text = "\n".join(item.text for item in items)
        candidates = extract_yen_price_candidates(items)
        prices = unique_numbers([candidate.value for candidate in candidates])
        warning = None
        if not prices and len(regions) > 1:
            warning = "No yen price found after full-image and price-tag crop OCR."

        return JSONResponse(
            {
                "candidates": [asdict(candidate) for candidate in candidates[:8]],
                "prices": prices,
                "regions": [
                    {"bbox": region.bbox, "label": region.label} for region in regions
                ],
                "source": "paddleocr-gpu",
                "text": text,
                "warning": warning,
                "yenPrice": prices[0] if prices else None,
            }
        )
    finally:
        for region in regions:
            if region.temporary:
                remove_quietly(region.path)
        remove_quietly(image_path)


def build_ocr_regions(image_path: str) -> list[OcrRegion]:
    regions = [OcrRegion(label="full", path=image_path)]

    try:
        image = Image.open(image_path).convert("RGB")
    except Exception:
        return regions

    for index, bbox in enumerate(detect_white_price_tag_regions(image), start=1):
        crop = image.crop(bbox)
        with tempfile.NamedTemporaryFile(delete=False, suffix=".jpg") as temp:
            crop.save(temp.name, format="JPEG", quality=95)
            regions.append(
                OcrRegion(
                    bbox=bbox,
                    label=f"white-tag-{index}",
                    path=temp.name,
                    temporary=True,
                )
            )

    return regions


def detect_white_price_tag_regions(
    image: Image.Image,
    max_regions: int | None = None,
) -> list[tuple[int, int, int, int]]:
    max_regions = max_regions or int(os.getenv("POKEARB_PRICE_OCR_MAX_CROPS", "4"))
    original_width, original_height = image.size
    if original_width <= 0 or original_height <= 0:
        return []

    scale = min(1.0, 640 / max(original_width, original_height))
    small_size = (
        max(1, int(original_width * scale)),
        max(1, int(original_height * scale)),
    )
    small = image.resize(small_size) if scale < 1 else image.copy()
    width, height = small.size
    pixels = image_pixels(small)
    mask = bytearray(width * height)

    for index, (red, green, blue) in enumerate(pixels):
        high = max(red, green, blue)
        low = min(red, green, blue)
        average = (red + green + blue) / 3
        if average >= 178 and high - low <= 58:
            mask[index] = 1

    visited = bytearray(width * height)
    components: list[tuple[float, int, int, int, int]] = []
    min_area = max(80, int(width * height * 0.0025))

    for start in range(width * height):
        if not mask[start] or visited[start]:
            continue

        stack = [start]
        visited[start] = 1
        count = 0
        min_x = width
        min_y = height
        max_x = 0
        max_y = 0

        while stack:
            current = stack.pop()
            count += 1
            x = current % width
            y = current // width
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)

            for neighbor in neighbors(current, x, y, width, height):
                if mask[neighbor] and not visited[neighbor]:
                    visited[neighbor] = 1
                    stack.append(neighbor)

        box_width = max_x - min_x + 1
        box_height = max_y - min_y + 1
        box_area = box_width * box_height
        if count < min_area or box_width < 38 or box_height < 16:
            continue

        aspect = box_width / box_height
        fill_ratio = count / box_area
        image_ratio = box_area / (width * height)
        if aspect < 1.15 or aspect > 9 or fill_ratio < 0.28 or image_ratio > 0.45:
            continue

        score = count + box_width * 6 + box_height * 2
        components.append((score, min_x, min_y, max_x + 1, max_y + 1))

    components.sort(reverse=True)
    bboxes: list[tuple[int, int, int, int]] = []
    for _, left, top, right, bottom in components:
        expanded = expand_bbox(
            (
                int(left / scale),
                int(top / scale),
                int(right / scale),
                int(bottom / scale),
            ),
            original_width,
            original_height,
        )
        if any(overlap_ratio(expanded, existing) > 0.75 for existing in bboxes):
            continue
        bboxes.append(expanded)
        if len(bboxes) >= max_regions:
            break

    return bboxes


def neighbors(index: int, x: int, y: int, width: int, height: int) -> list[int]:
    result: list[int] = []
    if x > 0:
        result.append(index - 1)
    if x < width - 1:
        result.append(index + 1)
    if y > 0:
        result.append(index - width)
    if y < height - 1:
        result.append(index + width)
    return result


def image_pixels(image: Image.Image) -> list[tuple[int, int, int]]:
    get_flattened_data = getattr(image, "get_flattened_data", None)
    if callable(get_flattened_data):
        return list(get_flattened_data())

    return list(image.getdata())


def expand_bbox(
    bbox: tuple[int, int, int, int],
    image_width: int,
    image_height: int,
) -> tuple[int, int, int, int]:
    left, top, right, bottom = bbox
    pad_x = max(8, int((right - left) * 0.08))
    pad_y = max(8, int((bottom - top) * 0.16))
    return (
        max(0, left - pad_x),
        max(0, top - pad_y),
        min(image_width, right + pad_x),
        min(image_height, bottom + pad_y),
    )


def overlap_ratio(
    left: tuple[int, int, int, int],
    right: tuple[int, int, int, int],
) -> float:
    ax1, ay1, ax2, ay2 = left
    bx1, by1, bx2, by2 = right
    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)
    if ix2 <= ix1 or iy2 <= iy1:
        return 0

    intersection = (ix2 - ix1) * (iy2 - iy1)
    smaller_area = min((ax2 - ax1) * (ay2 - ay1), (bx2 - bx1) * (by2 - by1))
    return intersection / smaller_area if smaller_area else 0


def run_ocr(image_path: str) -> list[str]:
    return [item.text for item in run_ocr_items(OcrRegion(label="full", path=image_path))]


def run_ocr_items(region: OcrRegion) -> list[OcrItem]:
    ocr = get_ocr()

    if hasattr(ocr, "predict"):
        result = ocr.predict(region.path)
    else:
        result = ocr.ocr(region.path, cls=False)

    return extract_ocr_items(result, region)


def extract_text_lines(value: Any) -> list[str]:
    return [item.text for item in extract_ocr_items(value, OcrRegion("full", ""))]


def extract_ocr_items(value: Any, region: OcrRegion) -> list[OcrItem]:
    items: list[OcrItem] = []

    def add_item(
        text: str,
        confidence: float | None = None,
        box: Any = None,
    ) -> None:
        clean = text.strip()
        if not clean:
            return

        items.append(
            OcrItem(
                box=normalize_box(box, region),
                confidence=confidence,
                region=region.label,
                text=clean,
            )
        )

    def visit(node: Any) -> None:
        if node is None:
            return

        if isinstance(node, str):
            add_item(node)
            return

        json_value = getattr(node, "json", None)
        if isinstance(json_value, dict):
            visit(json_value)
            return

        if isinstance(node, dict):
            if add_items_from_dict(node, add_item):
                return

            for key in ("text", "description", "transcription"):
                text = node.get(key)
                if isinstance(text, str):
                    add_item(text, read_float(node.get("score") or node.get("confidence")))

            for child in node.values():
                if isinstance(child, (dict, list, tuple)):
                    visit(child)
            return

        if isinstance(node, (list, tuple)):
            # PaddleOCR 2.x shape: [box, (text, confidence)]
            if len(node) == 2 and isinstance(node[1], (list, tuple)) and node[1]:
                maybe_text = node[1][0]
                if isinstance(maybe_text, str):
                    confidence = read_float(node[1][1] if len(node[1]) > 1 else None)
                    add_item(maybe_text, confidence, node[0])
                    return

            for item in node:
                visit(item)

    visit(value)
    return unique_ocr_items(items)


def add_items_from_dict(node: dict[str, Any], add_item: Any) -> bool:
    texts = first_list(node, ("rec_texts", "texts"))
    if not texts:
        return False

    scores = first_list(node, ("rec_scores", "scores", "confidences")) or []
    boxes = first_list(
        node,
        ("rec_polys", "dt_polys", "rec_boxes", "boxes", "det_polys"),
    ) or []

    for index, text in enumerate(texts):
        if not isinstance(text, str):
            continue
        add_item(
            text,
            read_float(scores[index] if index < len(scores) else None),
            boxes[index] if index < len(boxes) else None,
        )

    return True


def extract_yen_prices(text: str) -> list[int]:
    items = [OcrItem(text=line, confidence=None, box=None, region="text") for line in text.splitlines()]
    return unique_numbers([candidate.value for candidate in extract_yen_price_candidates(items)])


def extract_yen_price_candidates(items: list[OcrItem]) -> list[PriceCandidate]:
    candidates: list[PriceCandidate] = []
    for item in items:
        for candidate in find_price_candidates(item.text):
            score = candidate.score
            if item.confidence is not None:
                score += item.confidence * 20
            if item.region.startswith("white-tag"):
                score += 38
            if item.box is not None:
                left, top, right, bottom = item.box
                score += min(18, max(0, bottom - top) / 3)
                score += min(10, max(0, right - left) / 60)

            candidates.append(
                PriceCandidate(
                    box=item.box,
                    confidence=item.confidence,
                    region=item.region,
                    score=score,
                    text=item.text,
                    value=candidate.value,
                )
            )

    candidates.sort(key=lambda candidate: candidate.score, reverse=True)
    return unique_price_candidates(candidates)


def find_price_candidates(text: str) -> list[PriceCandidate]:
    normalized = normalize_ocr_text(text)
    patterns = [
        (
            re.compile(
                rf"(?:税込|税抜|特価|価格|値段|PRICE|JPY)\s*[:：]?\s*[¥Y]?\s*{LABELED_YEN_TOKEN}",
                re.I,
            ),
            120,
        ),
        (re.compile(rf"[¥Y]\s*{LABELED_YEN_TOKEN}", re.I), 110),
        (re.compile(rf"{LABELED_YEN_TOKEN}\s*(?:円|YEN|JPY)", re.I), 105),
        (re.compile(rf"\b{UNLABELED_YEN_TOKEN}\b", re.I), 20),
    ]

    candidates: list[PriceCandidate] = []
    for pattern, base_score in patterns:
        for match in pattern.finditer(normalized):
            for parsed in parse_yen_token_candidates(match.group(1)):
                candidates.append(
                    PriceCandidate(
                        box=None,
                        confidence=None,
                        region="text",
                        score=base_score + digit_score(parsed.value) + parsed.score_bonus,
                        text=text,
                        value=parsed.value,
                    )
                )

    candidates.sort(key=lambda candidate: candidate.score, reverse=True)
    return unique_price_candidates(candidates)


def normalize_ocr_text(text: str) -> str:
    return text.replace("￥", "¥").replace("，", ",")


def parse_yen_token_candidates(value: str) -> list[ParsedYenCandidate]:
    has_grouping = bool(re.search(r"[,.\s]", value))
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
        return []

    candidates: list[ParsedYenCandidate] = []
    parsed = parse_valid_yen_digits(digits)
    if parsed is not None:
        candidates.append(ParsedYenCandidate(value=parsed, score_bonus=0))

    if not has_grouping:
        candidates.extend(split_likely_run_on_price(digits))

    return unique_parsed_yen_candidates(candidates)


def split_likely_run_on_price(digits: str) -> list[ParsedYenCandidate]:
    if len(digits) < 5:
        return []

    candidates: list[ParsedYenCandidate] = []
    for suffix_length, bonus in ((2, 45), (3, 32)):
        if len(digits) <= suffix_length + 2:
            continue
        suffix = int(digits[-suffix_length:])
        prefix = parse_valid_yen_digits(digits[:-suffix_length])
        if prefix is not None and is_likely_attack_damage_suffix(suffix):
            candidates.append(ParsedYenCandidate(value=prefix, score_bonus=bonus))

    return candidates


def parse_valid_yen_digits(digits: str) -> int | None:
    parsed = int(digits)
    if parsed < 100 or parsed > 10_000_000:
        return None
    return parsed


def is_likely_attack_damage_suffix(value: int) -> bool:
    return 10 <= value <= 330 and value % 10 == 0


def digit_score(value: int) -> int:
    return 20 if value >= 1000 else 0


def normalize_box(
    box: Any,
    region: OcrRegion,
) -> tuple[int, int, int, int] | None:
    if box is None:
        return None

    if hasattr(box, "tolist"):
        box = box.tolist()

    if not isinstance(box, (list, tuple)):
        return None

    values = list(box)
    if len(values) == 4 and all(isinstance(item, (int, float)) for item in values):
        left, top, right, bottom = values
    else:
        points: list[tuple[float, float]] = []
        for point in values:
            if hasattr(point, "tolist"):
                point = point.tolist()
            if (
                isinstance(point, (list, tuple))
                and len(point) >= 2
                and isinstance(point[0], (int, float))
                and isinstance(point[1], (int, float))
            ):
                points.append((float(point[0]), float(point[1])))
        if not points:
            return None
        left = min(point[0] for point in points)
        top = min(point[1] for point in points)
        right = max(point[0] for point in points)
        bottom = max(point[1] for point in points)

    offset_x = region.bbox[0] if region.bbox else 0
    offset_y = region.bbox[1] if region.bbox else 0
    return (
        int(round(left + offset_x)),
        int(round(top + offset_y)),
        int(round(right + offset_x)),
        int(round(bottom + offset_y)),
    )


def first_list(node: dict[str, Any], keys: tuple[str, ...]) -> list[Any] | None:
    for key in keys:
        value = node.get(key)
        if hasattr(value, "tolist"):
            value = value.tolist()
        if isinstance(value, list):
            return value
    return None


def read_float(value: Any) -> float | None:
    try:
        if value is None:
            return None
        parsed = float(value)
        return parsed if parsed == parsed else None
    except (TypeError, ValueError):
        return None


def unique_ocr_items(items: list[OcrItem]) -> list[OcrItem]:
    seen: set[tuple[str, tuple[int, int, int, int] | None, str]] = set()
    result: list[OcrItem] = []
    for item in items:
        key = (item.text, item.box, item.region)
        if key in seen:
            continue
        seen.add(key)
        result.append(item)
    return result


def unique_price_candidates(candidates: list[PriceCandidate]) -> list[PriceCandidate]:
    best: dict[int, PriceCandidate] = {}
    for candidate in candidates:
        current = best.get(candidate.value)
        if current is None or candidate.score > current.score:
            best[candidate.value] = candidate
    return sorted(best.values(), key=lambda candidate: candidate.score, reverse=True)


def unique_parsed_yen_candidates(
    candidates: list[ParsedYenCandidate],
) -> list[ParsedYenCandidate]:
    best: dict[int, ParsedYenCandidate] = {}
    for candidate in candidates:
        current = best.get(candidate.value)
        if current is None or candidate.score_bonus > current.score_bonus:
            best[candidate.value] = candidate
    return list(best.values())


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


def remove_quietly(path: str) -> None:
    try:
        os.remove(path)
    except OSError:
        pass
