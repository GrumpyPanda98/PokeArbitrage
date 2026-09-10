from __future__ import annotations

import argparse
from pathlib import Path

from card_matcher.embeddings import DEFAULT_EMBEDDING_MODEL, EmbeddingIndex, default_embedding_path
from card_matcher.faiss_store import FaissVectorStore


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a FAISS vector index from a DINOv3 .npz file.")
    parser.add_argument("--cache-dir", default="cache", help="Local cache directory.")
    parser.add_argument("--language", default="ja", help="Language code.")
    parser.add_argument("--model", default=DEFAULT_EMBEDDING_MODEL, help="Embedding model name.")
    parser.add_argument("--embedding-index", help="Input .npz embedding index.")
    parser.add_argument("--embedding-pooling", default="cls_register_mean", choices=["auto", "cls_register_mean", "register_mean"])
    parser.add_argument("--output", help="Output .faiss path.")
    args = parser.parse_args()

    embedding_path = Path(args.embedding_index) if args.embedding_index else default_embedding_path(
        args.cache_dir,
        args.language,
        args.model,
        pooling=args.embedding_pooling,
    )
    output = Path(args.output) if args.output else embedding_path.with_suffix(".faiss")
    store = FaissVectorStore(EmbeddingIndex.load(embedding_path))
    store.save(output)
    print(f"Wrote FAISS index: {output}")


if __name__ == "__main__":
    main()
