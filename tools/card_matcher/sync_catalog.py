from __future__ import annotations

import argparse
from pathlib import Path

from card_matcher.catalog import catalog_path, upsert_cards
from card_matcher.tcgdex import fetch_japanese_cards


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync card metadata into the local V2 catalog.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--language", default="ja", help="TCGdex language code.")
    parser.add_argument("--max-sets", type=int, help="Limit set count for quick experiments.")
    parser.add_argument("--set-id", action="append", dest="set_ids", help="Specific set id.")
    parser.add_argument("--latest-first", action="store_true", help="Sync newest sets first.")
    args = parser.parse_args()

    cards = fetch_japanese_cards(
        args.cache_dir,
        language=args.language,
        max_sets=args.max_sets,
        set_ids=args.set_ids,
        latest_first=args.latest_first,
    )
    count = upsert_cards(catalog_path(args.cache_dir), cards)
    print(f"Synced {count} cards into {catalog_path(args.cache_dir)}")


if __name__ == "__main__":
    main()
