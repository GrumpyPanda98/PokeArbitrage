from __future__ import annotations

import argparse

from card_matcher.embeddings import (
    DEFAULT_EMBEDDING_BACKEND,
    GpuEmbeddingModel,
    build_embedding_index,
    default_embedding_path_for_mode,
    embedding_model_name_for_backend,
)
from card_matcher.index_store import index_path, load_index


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a GPU image embedding index.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--index", help="Explicit image index JSON path.")
    parser.add_argument("--language", default="ja", help="Index language code.")
    parser.add_argument(
        "--embedding-backend",
        default=DEFAULT_EMBEDDING_BACKEND,
        choices=["dinov2", "dinov3"],
        help="Select the default embedding backend.",
    )
    parser.add_argument("--model", help="Explicit Hugging Face vision model override.")
    parser.add_argument(
        "--embedding-pooling",
        default="cls_register_mean",
        choices=["auto", "cls_register_mean", "register_mean"],
    )
    parser.add_argument("--device", default="auto", help="auto, cuda, or cpu.")
    parser.add_argument("--batch-size", type=int, default=16, help="Embedding batch size.")
    parser.add_argument("--output", help="Output .npz path.")
    parser.add_argument("--clean-scans", action="store_true", help="Use fast normalization for clean reference scans.")
    parser.add_argument(
        "--region-level-embeddings",
        action="store_true",
        help="Include ROI-level reference embeddings in addition to full-card embeddings.",
    )
    args = parser.parse_args()

    card_index = load_index(args.index or index_path(args.cache_dir, args.language))
    model_name = args.model or embedding_model_name_for_backend(args.embedding_backend)
    model = GpuEmbeddingModel(
        model_name=model_name,
        device=args.device,
        pooling=args.embedding_pooling,
    )
    embedding_index = build_embedding_index(
        card_index,
        model,
        batch_size=args.batch_size,
        clean_scans=args.clean_scans,
        region_level=args.region_level_embeddings,
    )
    destination = args.output or default_embedding_path_for_mode(
        args.cache_dir,
        args.language,
        model_name,
        args.region_level_embeddings,
        pooling=args.embedding_pooling,
    )
    embedding_index.save(destination)
    print(f"Wrote embedding index: {destination}")


if __name__ == "__main__":
    main()
