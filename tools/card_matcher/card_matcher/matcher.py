from __future__ import annotations

from pathlib import Path

from .image_ops import (
    color_histogram,
    hash_distance,
    histogram_similarity,
    load_bgr_image,
    normalize_card_image,
    normalize_card_image_candidates,
    orb_similarity,
    perceptual_hashes,
)
from .embeddings import EmbeddingIndex, GpuEmbeddingModel, cosine_similarities
from .index_store import CardIndex, load_index
from .models import MatchResult


class CardMatcher:
    def __init__(
        self,
        index: CardIndex,
        embedding_index: EmbeddingIndex | None = None,
        embedding_model: GpuEmbeddingModel | None = None,
        embedding_weight: float = 0.52,
    ):
        self.index = index
        self.cards = index.by_id
        self.embedding_index = embedding_index
        self.embedding_model = embedding_model
        self.embedding_weight = max(0.0, min(0.85, embedding_weight))

    @classmethod
    def from_index_path(
        cls,
        path: str | Path,
        embedding_index_path: str | Path | None = None,
        embedding_model_name: str | None = None,
        device: str = "auto",
        embedding_weight: float = 0.52,
    ) -> "CardMatcher":
        embedding_index = (
            EmbeddingIndex.load(embedding_index_path) if embedding_index_path else None
        )
        embedding_model = (
            GpuEmbeddingModel(
                model_name=embedding_model_name or embedding_index.model_name,
                device=device,
            )
            if embedding_index
            else None
        )
        return cls(
            load_index(path),
            embedding_index=embedding_index,
            embedding_model=embedding_model,
            embedding_weight=embedding_weight,
        )

    def match(self, image_path: str | Path, top: int = 10, coarse_limit: int = 80) -> list[MatchResult]:
        query_image = load_bgr_image(image_path)
        query_variants = normalize_card_image_candidates(query_image)
        embedding_scores = self.embedding_scores(query_variants)

        coarse_by_card: dict[str, tuple[float, float, float, str, int]] = {}
        for variant_index, query_variant in enumerate(query_variants):
            query_phash, query_dhash = perceptual_hashes(query_variant.image)
            query_histogram = color_histogram(query_variant.image)

            for fingerprint in self.index.fingerprints:
                phash_distance = hash_distance(query_phash, fingerprint.phash)
                dhash_distance = hash_distance(query_dhash, fingerprint.dhash)
                average_hash_distance = (phash_distance + dhash_distance) / 2.0
                hist_score = histogram_similarity(query_histogram, fingerprint.histogram)
                coarse_score = hash_score(average_hash_distance) * 0.72 + hist_score * 0.28
                embedding_score = embedding_scores.get(fingerprint.card_id)
                if embedding_score is not None:
                    coarse_score = (
                        coarse_score * (1.0 - self.embedding_weight)
                        + embedding_score * self.embedding_weight
                    )

                current = coarse_by_card.get(fingerprint.card_id)
                if current is None or coarse_score > current[0]:
                    coarse_by_card[fingerprint.card_id] = (
                        coarse_score,
                        average_hash_distance,
                        hist_score,
                        fingerprint.card_id,
                        variant_index,
                    )

        reranked: list[MatchResult] = []
        for coarse_score, average_hash_distance, hist_score, card_id, variant_index in sorted(
            coarse_by_card.values(),
            key=lambda item: item[0],
            reverse=True,
        )[:coarse_limit]:
            card = self.cards.get(card_id)
            if not card:
                continue

            query_variant = query_variants[variant_index]
            try:
                reference_image = load_bgr_image(card.image_path)
                reference_normalized, _ = normalize_card_image(reference_image)
                orb_score = orb_similarity(query_variant.image, reference_normalized)
            except Exception:
                orb_score = 0.0

            embedding_score = embedding_scores.get(card_id, 0.0)
            base_score = coarse_score * 0.62 + orb_score * 0.38
            final_score = (
                base_score * (1.0 - self.embedding_weight)
                + embedding_score * self.embedding_weight
                if embedding_scores
                else base_score
            )
            reranked.append(
                MatchResult(
                    card=card,
                    score=final_score,
                    hash_distance=average_hash_distance,
                    histogram_similarity=hist_score,
                    orb_similarity=orb_score,
                    crop_used=query_variant.crop_used,
                    embedding_similarity=embedding_score,
                    crop_label=query_variant.label,
                ),
            )

        return sorted(reranked, key=lambda item: item.score, reverse=True)[:top]

    def embedding_scores(self, query_variants) -> dict[str, float]:
        if not self.embedding_index or not self.embedding_model:
            return {}

        query_embeddings = self.embedding_model.embed_query_variants(
            [variant.image for variant in query_variants],
        )
        scores: dict[str, float] = {}
        for query_embedding in query_embeddings:
            similarities = cosine_similarities(
                query_embedding,
                self.embedding_index.embeddings,
            )
            for card_id, score in zip(self.embedding_index.card_ids, similarities):
                normalized_score = max(0.0, min(1.0, (float(score) + 1.0) / 2.0))
                scores[card_id] = max(scores.get(card_id, 0.0), normalized_score)
        return scores


def hash_score(distance: float) -> float:
    return max(0.0, min(1.0, 1.0 - distance / 64.0))
