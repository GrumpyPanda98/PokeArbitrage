from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .embeddings import EmbeddingIndex, cosine_similarities


@dataclass(frozen=True)
class VectorSearchResult:
    card_id: str
    score: float
    vector_index: int


class FaissVectorStore:
    def __init__(self, embedding_index: EmbeddingIndex) -> None:
        try:
            import faiss
        except ImportError as error:
            raise RuntimeError(
                "FAISS is not installed. Install faiss-cpu/faiss-gpu in the matcher environment."
            ) from error

        self.faiss = faiss
        self.embedding_index = embedding_index
        vectors = np.ascontiguousarray(embedding_index.embeddings.astype(np.float32))
        self.index = faiss.IndexFlatIP(vectors.shape[1])
        self.index.add(vectors)

    def search(self, query: np.ndarray, top: int = 20) -> list[VectorSearchResult]:
        query_vector = np.ascontiguousarray(query.astype(np.float32).reshape(1, -1))
        distances, indices = self.index.search(query_vector, top)
        return [
            VectorSearchResult(
                card_id=self.embedding_index.card_ids[int(index)],
                score=float(score),
                vector_index=int(index),
            )
            for score, index in zip(distances[0], indices[0])
            if index >= 0
        ]

    def save(self, path: str | Path) -> None:
        destination = Path(path)
        destination.parent.mkdir(parents=True, exist_ok=True)
        self.faiss.write_index(self.index, str(destination))


def exact_vector_search(
    embedding_index: EmbeddingIndex,
    query: np.ndarray,
    top: int = 20,
) -> list[VectorSearchResult]:
    scores = cosine_similarities(query, embedding_index.embeddings)
    ranked = np.argsort(scores)[::-1][:top]
    return [
        VectorSearchResult(
            card_id=embedding_index.card_ids[int(index)],
            score=float(scores[int(index)]),
            vector_index=int(index),
        )
        for index in ranked
    ]
