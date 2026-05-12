from __future__ import annotations

import argparse

from card_matcher.embeddings import (
    DEFAULT_EMBEDDING_MODEL,
    GpuEmbeddingModel,
    build_embedding_index,
    default_embedding_path,
)
from card_matcher.index_store import index_path, load_index


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a GPU image embedding index.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--index", help="Explicit image index JSON path.")
    parser.add_argument("--language", default="ja", help="Index language code.")
    parser.add_argument("--model", default=DEFAULT_EMBEDDING_MODEL, help="Hugging Face vision model.")
    parser.add_argument("--device", default="auto", help="auto, cuda, or cpu.")
    parser.add_argument("--batch-size", type=int, default=16, help="Embedding batch size.")
    parser.add_argument("--output", help="Output .npz path.")
    parser.add_argument("--clean-scans", action="store_true", help="Use fast normalization for clean reference scans.")
    args = parser.parse_args()

    card_index = load_index(args.index or index_path(args.cache_dir, args.language))
    model = GpuEmbeddingModel(model_name=args.model, device=args.device)
    embedding_index = build_embedding_index(
        card_index,
        model,
        batch_size=args.batch_size,
        clean_scans=args.clean_scans,
    )
    destination = args.output or default_embedding_path(args.cache_dir, args.language, args.model)
    embedding_index.save(destination)
    print(f"Wrote embedding index: {destination}")


if __name__ == "__main__":
    main()
