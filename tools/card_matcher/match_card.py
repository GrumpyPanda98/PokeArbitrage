from __future__ import annotations

import argparse
import json
from pathlib import Path

from card_matcher.image_ops import load_bgr_image, save_normalized_candidates
from card_matcher.index_store import index_path
from card_matcher.matcher import CardMatcher


def main() -> None:
    parser = argparse.ArgumentParser(description="Match one card photo against the local index.")
    parser.add_argument("image", help="Path to a card photo.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--index", help="Explicit index JSON path.")
    parser.add_argument("--language", default="ja", help="Index language code.")
    parser.add_argument("--top", type=int, default=10, help="Number of matches to print.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--embedding-index", help="Optional GPU embedding .npz index.")
    parser.add_argument("--model", help="Vision model name for the embedding index.")
    parser.add_argument("--device", default="auto", help="auto, cuda, or cpu for embeddings.")
    parser.add_argument(
        "--embedding-weight",
        type=float,
        default=0.52,
        help="Blend weight for GPU embedding similarity.",
    )
    parser.add_argument("--debug-dir", help="Write normalized query crops for inspection.")
    args = parser.parse_args()

    if args.debug_dir:
        save_normalized_candidates(
            load_bgr_image(args.image),
            args.debug_dir,
            prefix=Path(args.image).stem,
        )

    matcher = CardMatcher.from_index_path(
        Path(args.index) if args.index else index_path(args.cache_dir, args.language),
        embedding_index_path=args.embedding_index,
        embedding_model_name=args.model,
        device=args.device,
        embedding_weight=args.embedding_weight,
    )
    matches = matcher.match(args.image, top=args.top)

    if args.json:
        print(json.dumps([match.to_json() for match in matches], ensure_ascii=False, indent=2))
        return

    for rank, match in enumerate(matches, start=1):
        card = match.card
        print(
            f"{rank:02d}. {card.id} | {card.name} | {card.set_name} #{card.local_id} "
            f"| score={match.score:.3f} hash={match.hash_distance:.1f} "
            f"hist={match.histogram_similarity:.3f} orb={match.orb_similarity:.3f} "
            f"embed={match.embedding_similarity:.3f} crop={match.crop_label}"
        )


if __name__ == "__main__":
    main()
