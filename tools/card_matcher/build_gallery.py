from __future__ import annotations

import argparse
from pathlib import Path

from card_matcher.build import build_reference_index


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the V2 reference gallery.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--language", default="ja", help="TCGdex language code.")
    parser.add_argument("--max-sets", type=int, help="Limit set count for quick experiments.")
    parser.add_argument("--set-id", action="append", dest="set_ids", help="Specific set id.")
    parser.add_argument("--latest-first", action="store_true", help="Index newest sets first.")
    args = parser.parse_args()

    path = build_reference_index(
        Path(args.cache_dir),
        language=args.language,
        max_sets=args.max_sets,
        set_ids=args.set_ids,
        latest_first=args.latest_first,
    )
    print(f"Wrote gallery index: {path}")


if __name__ == "__main__":
    main()
