from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any
from urllib.parse import urljoin

import requests
from tqdm import tqdm

from .models import CardMetadata


POKEMON_CARD_BASE_URL = "https://www.pokemon-card.com"
OFFICIAL_SEARCH_API = f"{POKEMON_CARD_BASE_URL}/card-search/resultAPI.php"
OFFICIAL_USER_AGENT = "PokéArbitrage local card identifier"


def fetch_official_japanese_cards(
    cache_dir: str | Path,
    image_workers: int = 16,
) -> list[CardMetadata]:
    cache = Path(cache_dir)
    page_dir = cache / "metadata" / "official_jp" / "pages"
    image_dir = cache / "images" / "official_jp"
    page_dir.mkdir(parents=True, exist_ok=True)
    image_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": OFFICIAL_USER_AGENT,
            "Referer": f"{POKEMON_CARD_BASE_URL}/card-search/index.php?regulation_detail=all",
        },
    )

    first_page = fetch_result_page(session, page_dir, 1)
    max_page = int(first_page.get("maxPage") or 1)
    pages = [first_page]
    for page in tqdm(range(2, max_page + 1), desc="Fetching official JP pages"):
        pages.append(fetch_result_page(session, page_dir, page))

    pending: list[tuple[str, str, str, str, Path]] = []
    seen: set[str] = set()
    for page in pages:
        for item in page.get("cardList") or []:
            if not isinstance(item, dict):
                continue

            card_id = str(item.get("cardID") or "").strip()
            image_path_fragment = str(item.get("cardThumbFile") or "").strip()
            name = str(item.get("cardNameAltText") or item.get("cardNameViewText") or "").strip()
            if not card_id or not image_path_fragment or card_id in seen:
                continue

            image_url = urljoin(POKEMON_CARD_BASE_URL, image_path_fragment)
            set_id = set_id_from_official_image_path(image_path_fragment)
            local_path = image_dir / set_id / f"{card_id}{Path(image_path_fragment).suffix or '.jpg'}"
            seen.add(card_id)
            pending.append((card_id, name, set_id, image_url, local_path))

    downloaded = download_images_concurrently(pending, image_workers=image_workers)
    cards: list[CardMetadata] = []
    for card_id, name, set_id, image_url, local_path in pending:
        if str(local_path) not in downloaded:
            continue

        cards.append(
            CardMetadata(
                id=f"official-jp-{card_id}",
                name=name,
                set_id=set_id,
                set_name=set_id,
                local_id=card_id,
                image_url=image_url,
                image_path=str(local_path),
                language="ja",
                tcgdex_id="",
                marketplace_url=f"{POKEMON_CARD_BASE_URL}/card-search/details.php/card/{card_id}/regu/all",
            ),
        )

    return cards


def iter_official_japanese_card_items(cache_dir: str | Path) -> list[dict[str, str]]:
    cache = Path(cache_dir)
    page_dir = cache / "metadata" / "official_jp" / "pages"
    page_dir.mkdir(parents=True, exist_ok=True)
    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": OFFICIAL_USER_AGENT,
            "Referer": f"{POKEMON_CARD_BASE_URL}/card-search/index.php?regulation_detail=all",
        },
    )
    first_page = fetch_result_page(session, page_dir, 1)
    max_page = int(first_page.get("maxPage") or 1)
    items: list[dict[str, str]] = []
    for page_number in range(1, max_page + 1):
        page = first_page if page_number == 1 else fetch_result_page(session, page_dir, page_number)
        for item in page.get("cardList") or []:
            if isinstance(item, dict):
                items.append(
                    {
                        "cardID": str(item.get("cardID") or ""),
                        "cardThumbFile": str(item.get("cardThumbFile") or ""),
                        "cardNameAltText": str(item.get("cardNameAltText") or ""),
                        "cardNameViewText": str(item.get("cardNameViewText") or ""),
                    },
                )
    return items


def fetch_result_page(
    session: requests.Session,
    page_dir: Path,
    page: int,
) -> dict[str, Any]:
    path = page_dir / f"page-{page:05d}.json"
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))

    response = session.get(
        OFFICIAL_SEARCH_API,
        params={"regulation_detail": "all", "page": page},
        timeout=30,
    )
    response.raise_for_status()
    value = response.json()
    if value.get("result") != 1:
        raise ValueError(f"Official JP search failed for page {page}: {value.get('errMsg')}")
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2), encoding="utf-8")
    return value


def download_image(session: requests.Session, url: str, path: Path) -> bool:
    if path.exists() and path.stat().st_size > 0:
        return True

    response = session.get(url, timeout=30)
    if response.status_code == 404:
        return False
    response.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    return True


def download_images_concurrently(
    pending: list[tuple[str, str, str, str, Path]],
    image_workers: int,
) -> set[str]:
    if image_workers <= 1:
        session = requests.Session()
        session.headers.update({"User-Agent": OFFICIAL_USER_AGENT})
        downloaded: set[str] = set()
        for _, _, _, image_url, local_path in tqdm(pending, desc="Downloading official JP images"):
            if download_image(session, image_url, local_path):
                downloaded.add(str(local_path))
        return downloaded

    downloaded: set[str] = set()
    with ThreadPoolExecutor(max_workers=image_workers) as executor:
        futures = {
            executor.submit(download_one_image, image_url, local_path): local_path
            for _, _, _, image_url, local_path in pending
        }
        for future in tqdm(as_completed(futures), total=len(futures), desc="Downloading official JP images"):
            local_path = futures[future]
            try:
                if future.result():
                    downloaded.add(str(local_path))
            except Exception as error:
                print(f"Skipping official JP image {local_path}: {error}")
    return downloaded


def download_one_image(url: str, path: Path) -> bool:
    if path.exists() and path.stat().st_size > 0:
        return True

    response = requests.get(
        url,
        timeout=30,
        headers={"User-Agent": OFFICIAL_USER_AGENT},
    )
    if response.status_code == 404:
        return False
    response.raise_for_status()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(response.content)
    return True


def set_id_from_official_image_path(value: str) -> str:
    match = re.search(r"/large/([^/]+)/", value)
    return safe_set_id(match.group(1) if match else "official")


def safe_set_id(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9._-]+", "_", value).strip("_") or "official"
