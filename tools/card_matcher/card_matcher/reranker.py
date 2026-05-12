from __future__ import annotations

from dataclasses import dataclass
from difflib import SequenceMatcher

from .identity import normalize_collector_number, normalize_search_text
from .models import MatchResult
from .ocr import OcrFeatures


@dataclass(frozen=True)
class RerankWeights:
    visual: float = 0.45
    name: float = 0.15
    number: float = 0.20
    set_symbol: float = 0.10
    language: float = 0.05
    variant: float = 0.05


@dataclass(frozen=True)
class FeatureScores:
    visual_similarity: float
    name_score: float
    number_score: float
    set_symbol_score: float
    language_score: float
    variant_score: float

    def weighted(self, weights: RerankWeights) -> float:
        return (
            self.visual_similarity * weights.visual
            + self.name_score * weights.name
            + self.number_score * weights.number
            + self.set_symbol_score * weights.set_symbol
            + self.language_score * weights.language
            + self.variant_score * weights.variant
        )

    def to_json(self) -> dict[str, float]:
        return {
            "visual_similarity": round(self.visual_similarity, 5),
            "name_score": round(self.name_score, 5),
            "number_score": round(self.number_score, 5),
            "set_symbol_score": round(self.set_symbol_score, 5),
            "language_score": round(self.language_score, 5),
            "variant_score": round(self.variant_score, 5),
        }


@dataclass(frozen=True)
class RerankedMatch:
    match: MatchResult
    score: float
    feature_scores: FeatureScores


def rerank_matches(
    matches: list[MatchResult],
    ocr: OcrFeatures | None = None,
    weights: RerankWeights = RerankWeights(),
) -> list[RerankedMatch]:
    if not matches:
        return []

    ocr = ocr or OcrFeatures()
    adjusted_weights = dynamic_weights(weights, ocr)
    reranked = [
        RerankedMatch(
            match=match,
            score=feature_scores(match, ocr).weighted(adjusted_weights),
            feature_scores=feature_scores(match, ocr),
        )
        for match in matches
    ]
    return sorted(reranked, key=lambda item: item.score, reverse=True)


def dynamic_weights(weights: RerankWeights, ocr: OcrFeatures) -> RerankWeights:
    if not any(
        [
            ocr.name.text,
            ocr.collector_number.text,
            ocr.attack_text.text,
            ocr.language.text,
        ],
    ):
        return RerankWeights(visual=1.0, name=0.0, number=0.0, set_symbol=0.0, language=0.0, variant=0.0)

    if ocr.collector_number.text and ocr.collector_number.confidence >= 0.82:
        return RerankWeights(
            visual=0.34,
            name=weights.name,
            number=0.34,
            set_symbol=weights.set_symbol,
            language=weights.language,
            variant=weights.variant,
        )
    return weights


def feature_scores(match: MatchResult, ocr: OcrFeatures) -> FeatureScores:
    card = match.card
    return FeatureScores(
        visual_similarity=clamp(match.embedding_similarity or match.score),
        name_score=text_similarity(ocr.name.text, card.name) if ocr.name.text else 0.0,
        number_score=collector_score(ocr.collector_number.text, card.collector_number),
        set_symbol_score=0.0,
        language_score=language_score(ocr.language.text, card.language),
        variant_score=0.0,
    )


def text_similarity(left: str, right: str) -> float:
    left_normalized = normalize_search_text(left)
    right_normalized = normalize_search_text(right)
    if not left_normalized or not right_normalized:
        return 0.0
    if left_normalized == right_normalized:
        return 1.0
    if left_normalized in right_normalized or right_normalized in left_normalized:
        return 0.88
    return clamp(SequenceMatcher(None, left_normalized, right_normalized).ratio())


def collector_score(left: str, right: str) -> float:
    left_number = normalize_collector_number(left)
    right_number = normalize_collector_number(right)
    if not left_number or not right_number:
        return 0.0
    if left_number == right_number:
        return 1.0
    if left_number.split("/", 1)[0] == right_number.split("/", 1)[0]:
        return 0.78
    return 0.0


def language_score(left: str, right: str) -> float:
    if not left:
        return 0.0
    return 1.0 if left.lower().split("-", 1)[0] == right.lower().split("-", 1)[0] else 0.0


def clamp(value: float) -> float:
    return max(0.0, min(1.0, float(value)))
