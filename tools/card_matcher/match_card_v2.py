from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from card_matcher.contract import result_from_reranked
from card_matcher.image_ops import load_bgr_image, normalize_card_image_candidates, save_normalized_candidates
from card_matcher.index_store import index_path
from card_matcher.matcher import CardMatcher
from card_matcher.ocr import OcrFeatures, PaddleOcrReader
from card_matcher.reranker import rerank_matches
from card_matcher.roi import save_rois


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")

    parser = argparse.ArgumentParser(description="Run the V2 hybrid card identifier contract.")
    parser.add_argument("image", help="Path to a card photo.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--index", help="Explicit image index JSON path.")
    parser.add_argument("--language", default="ja", help="Index language code.")
    parser.add_argument("--top", type=int, default=8, help="Number of candidates to return.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    parser.add_argument("--embedding-index", help="DINOv3 embedding .npz index.")
    parser.add_argument("--embedding-pooling", choices=["auto", "cls_register_mean", "register_mean"], help="Override pooling for a legacy index without stored pooling metadata.")
    parser.add_argument("--model", help="Vision model name for the embedding index.")
    parser.add_argument("--device", default="auto", help="auto, cuda, or cpu for embeddings.")
    parser.add_argument("--embedding-weight", type=float, default=0.52)
    parser.add_argument("--ocr", action="store_true", help="Run PaddleOCR over V2 ROIs.")
    parser.add_argument("--debug-dir", help="Write normalized crops and ROI crops.")
    args = parser.parse_args()

    source_image = load_bgr_image(args.image)
    if args.debug_dir:
        save_normalized_candidates(source_image, args.debug_dir, prefix=Path(args.image).stem)

    matcher = CardMatcher.from_index_path(
        Path(args.index) if args.index else index_path(args.cache_dir, args.language),
        embedding_index_path=args.embedding_index,
        embedding_model_name=args.model,
        device=args.device,
        embedding_weight=args.embedding_weight,
        embedding_pooling=args.embedding_pooling,
    )
    matches = matcher.match(args.image, top=max(args.top, 20))
    ocr = read_ocr_features(source_image, args.ocr)
    reranked = rerank_matches(matches, ocr)
    result = result_from_reranked(reranked, ocr=ocr, limit=args.top)

    if args.debug_dir:
        best_crop = normalize_card_image_candidates(source_image, max_candidates=1)[0].image
        save_rois(best_crop, args.debug_dir, prefix=f"{Path(args.image).stem}-roi")

    if args.json:
        print(json.dumps(result.to_json(), ensure_ascii=False, indent=2))
        return

    best = result.best
    if not best:
        print("No match.")
        return
    card = best.card
    print(
        f"{card.canonical_print_uid} | {card.name} | {card.set_name} "
        f"#{card.collector_number} | confidence={best.score:.3f}"
    )


def read_ocr_features(source_image, enabled: bool) -> OcrFeatures:
    if not enabled:
        return OcrFeatures()

    try:
        normalized = normalize_card_image_candidates(source_image, max_candidates=1)[0].image
        return PaddleOcrReader().read_card(normalized)
    except Exception as error:
        return OcrFeatures(raw_text=f"OCR unavailable: {error}")


if __name__ == "__main__":
    main()
