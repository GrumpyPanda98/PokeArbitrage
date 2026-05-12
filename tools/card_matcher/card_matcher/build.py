from __future__ import annotations

from pathlib import Path

from tqdm import tqdm

from .image_ops import color_histogram, load_bgr_image, normalize_card_image, perceptual_hashes
from .index_store import CardIndex, index_path, save_index
from .models import ImageFingerprint
from .tcgdex import fetch_japanese_cards


def build_reference_index(
    cache_dir: str | Path,
    language: str = "ja",
    max_sets: int | None = None,
    set_ids: list[str] | None = None,
    latest_first: bool = False,
) -> Path:
    cards = fetch_japanese_cards(
        cache_dir,
        language=language,
        max_sets=max_sets,
        set_ids=set_ids,
        latest_first=latest_first,
    )
    fingerprints: list[ImageFingerprint] = []

    for card in tqdm(cards, desc="Fingerprinting card images"):
        try:
            image = load_bgr_image(card.image_path)
            normalized, _ = normalize_card_image(image)
            phash, dhash = perceptual_hashes(normalized)
            fingerprints.append(
                ImageFingerprint(
                    card_id=card.id,
                    phash=phash,
                    dhash=dhash,
                    histogram=color_histogram(normalized),
                ),
            )
        except Exception as error:
            print(f"Skipping {card.id}: {error}")

    destination = index_path(cache_dir, language)
    save_index(
        destination,
        CardIndex(cards=cards, fingerprints=fingerprints, language=language),
    )
    return destination
