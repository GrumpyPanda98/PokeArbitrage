from __future__ import annotations

import argparse
from pathlib import Path

from tqdm import tqdm

from card_matcher.image_ops import color_histogram, load_bgr_image, orient_portrait, perceptual_hashes, resize_card
from card_matcher.index_store import CardIndex, save_index
from card_matcher.models import ImageFingerprint
from card_matcher.official_jp import fetch_official_japanese_cards


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a gallery from the official Japanese card search.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument(
        "--output",
        default="cache/ja_official_image_index.json",
        help="Output index JSON.",
    )
    parser.add_argument("--image-workers", type=int, default=16, help="Concurrent image downloads.")
    args = parser.parse_args()

    cards = fetch_official_japanese_cards(args.cache_dir, image_workers=args.image_workers)
    fingerprints: list[ImageFingerprint] = []
    for card in tqdm(cards, desc="Fingerprinting official JP images"):
        try:
            image = load_bgr_image(card.image_path)
            normalized = resize_card(orient_portrait(image))
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

    save_index(
        args.output,
        CardIndex(cards=cards, fingerprints=fingerprints, language="ja"),
    )
    print(f"Wrote official JP gallery index: {Path(args.output)}")


if __name__ == "__main__":
    main()
