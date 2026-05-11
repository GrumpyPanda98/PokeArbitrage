from __future__ import annotations

import argparse
from pathlib import Path

from card_matcher.build import build_reference_index


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a local Pokemon card image index.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--language", default="ja", help="TCGdex language code.")
    parser.add_argument("--max-sets", type=int, help="Limit set count for quick experiments.")
    parser.add_argument(
        "--set-id",
        action="append",
        dest="set_ids",
        help="Specific TCGdex set id to index. Can be passed more than once.",
    )
    args = parser.parse_args()

    path = build_reference_index(
        Path(args.cache_dir),
        language=args.language,
        max_sets=args.max_sets,
        set_ids=args.set_ids,
    )
    print(f"Wrote index: {path}")


if __name__ == "__main__":
    main()
