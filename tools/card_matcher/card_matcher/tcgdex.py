from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

import requests

from .models import CardMetadata


TCGDEX_BASE_URL = "https://api.tcgdex.net/v2"
IMAGE_EXTENSIONS = ("high.webp", "low.webp", "high.png", "low.png")


def fetch_japanese_cards(
    cache_dir: str | Path,
    language: str = "ja",
    max_sets: int | None = None,
    set_ids: list[str] | None = None,
) -> list[CardMetadata]:
    cache = Path(cache_dir)
    metadata_dir = cache / "metadata" / language
    image_dir = cache / "images" / language
    metadata_dir.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)

    if set_ids:
        sets = [{"id": set_id, "name": set_id} for set_id in set_ids]
    else:
        sets = fetch_json_cached(
            f"{TCGDEX_BASE_URL}/{language}/sets",
            metadata_dir / "sets.json",
        )
        if not isinstance(sets, list):
            raise ValueError("TCGdex sets response was not a list")

    cards: list[CardMetadata] = []
    indexed_sets = 0
    for set_record in sets:
        if not isinstance(set_record, dict) or not set_record.get("id"):
            continue

        set_id = str(set_record["id"])
        set_detail = fetch_json_cached(
            f"{TCGDEX_BASE_URL}/{language}/sets/{set_id}",
            metadata_dir / f"set-{safe_file_name(set_id)}.json",
        )
        if not isinstance(set_detail, dict):
            continue

        set_name = str(set_detail.get("name") or set_record.get("name") or "")
        set_cards: list[CardMetadata] = []
        for brief in set_detail.get("cards") or []:
            if not isinstance(brief, dict):
                continue

            card_id = str(brief.get("id") or "")
            if not card_id:
                continue

            card_detail = fetch_json_cached(
                f"{TCGDEX_BASE_URL}/{language}/cards/{card_id}",
                metadata_dir / f"card-{safe_file_name(card_id)}.json",
            )
            if not isinstance(card_detail, dict):
                continue

            image_base = str(card_detail.get("image") or brief.get("image") or "")
            if not image_base:
                continue

            image_url, image_path = download_first_available_image(
                image_base,
                image_dir / f"{safe_file_name(card_id)}.webp",
            )
            if not image_url:
                continue

            set_cards.append(
                CardMetadata(
                    id=card_id,
                    name=str(card_detail.get("name") or brief.get("name") or ""),
                    set_id=set_id,
                    set_name=str(read_path(card_detail, ["set", "name"]) or set_name),
                    local_id=str(card_detail.get("localId") or brief.get("localId") or ""),
                    image_url=image_url,
                    image_path=str(image_path),
                    language=language,
                ),
            )

        if set_cards:
            cards.extend(set_cards)
            indexed_sets += 1

        if max_sets is not None and indexed_sets >= max_sets:
            break

    return cards


def fetch_json_cached(url: str, path: Path) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    response = requests.get(url, timeout=30)
    response.raise_for_status()
    value = response.json()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return value


def download_first_available_image(image_base: str, path: Path) -> tuple[str, Path]:
    if path.exists():
        return image_base, path

    for suffix in IMAGE_EXTENSIONS:
        image_url = f"{image_base}/{suffix}"
        response = requests.get(image_url, timeout=30)
        if response.status_code == 404:
            continue
        response.raise_for_status()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(response.content)
        return image_url, path

    return "", path


def safe_file_name(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value)


def read_path(value: dict[str, Any], path: list[str]) -> Any:
    current: Any = value
    for key in path:
        if not isinstance(current, dict):
            return None
        current = current.get(key)
    return current
