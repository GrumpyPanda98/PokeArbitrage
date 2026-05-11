from __future__ import annotations

import argparse
import csv
import json
from pathlib import Path

from card_matcher.index_store import index_path
from card_matcher.matcher import CardMatcher


def main() -> None:
    parser = argparse.ArgumentParser(description="Benchmark local card image matching.")
    parser.add_argument("labels", help="CSV with image_path,expected_card_id.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--index", help="Explicit index JSON path.")
    parser.add_argument("--language", default="ja", help="Index language code.")
    parser.add_argument("--top", type=int, default=5, help="Top-N success threshold.")
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
    args = parser.parse_args()

    matcher = CardMatcher.from_index_path(
        Path(args.index) if args.index else index_path(args.cache_dir, args.language),
        embedding_index_path=args.embedding_index,
        embedding_model_name=args.model,
        device=args.device,
        embedding_weight=args.embedding_weight,
    )
    rows = list(read_labels(args.labels))
    outcomes = []

    for image_path, expected_card_id in rows:
        matches = matcher.match(image_path, top=max(args.top, 10))
        ranked_ids = [match.card.id for match in matches]
        outcomes.append(
            {
                "image_path": image_path,
                "expected_card_id": expected_card_id,
                "top1": ranked_ids[0] if ranked_ids else "",
                "hit_top1": bool(ranked_ids and ranked_ids[0] == expected_card_id),
                f"hit_top{args.top}": expected_card_id in ranked_ids[: args.top],
                "matches": [match.to_json() for match in matches[: args.top]],
            },
        )

    top1_hits = sum(1 for item in outcomes if item["hit_top1"])
    topn_key = f"hit_top{args.top}"
    topn_hits = sum(1 for item in outcomes if item[topn_key])
    summary = {
        "count": len(outcomes),
        "top1_accuracy": top1_hits / len(outcomes) if outcomes else 0,
        f"top{args.top}_accuracy": topn_hits / len(outcomes) if outcomes else 0,
        "outcomes": outcomes,
    }

    if args.json:
        print(json.dumps(summary, ensure_ascii=False, indent=2))
        return

    print(
        f"Images: {summary['count']} | "
        f"Top-1: {summary['top1_accuracy']:.1%} | "
        f"Top-{args.top}: {summary[f'top{args.top}_accuracy']:.1%}"
    )
    for outcome in outcomes:
        print(
            f"{'OK' if outcome[topn_key] else 'MISS'} "
            f"{outcome['image_path']} expected={outcome['expected_card_id']} "
            f"top1={outcome['top1']}"
        )


def read_labels(path: str | Path) -> list[tuple[str, str]]:
    with Path(path).open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        return [
            (row["image_path"], row["expected_card_id"])
            for row in reader
            if row.get("image_path") and row.get("expected_card_id")
        ]


if __name__ == "__main__":
    main()
