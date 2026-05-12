from __future__ import annotations

from dataclasses import dataclass

from .identity import marketplace_queries
from .models import CardMetadata
from .ocr import OcrFeatures
from .reranker import RerankedMatch


@dataclass(frozen=True)
class RecognitionCandidate:
    card: CardMetadata
    score: float
    evidence: dict[str, float]
    rank: int

    def to_json(self) -> dict[str, object]:
        return {
            "canonical_print_uid": self.card.canonical_print_uid,
            "score": round(self.score, 5),
            "rank": self.rank,
            "card": self.card.to_json(),
            "evidence": self.evidence,
            "marketplaces": marketplace_queries(
                name=self.card.name,
                set_name=self.card.set_name,
                collector_number=self.card.collector_number,
                variant_class=self.card.variant_class,
            ),
        }


@dataclass(frozen=True)
class RecognitionResult:
    candidates: list[RecognitionCandidate]
    ocr: OcrFeatures

    @property
    def best(self) -> RecognitionCandidate | None:
        return self.candidates[0] if self.candidates else None

    def to_json(self) -> dict[str, object]:
        best = self.best
        recognized_fields = recognized_fields_json(best.card if best else None, self.ocr)
        return {
            "canonical_print_uid": best.card.canonical_print_uid if best else None,
            "match_confidence": round(best.score, 5) if best else 0.0,
            "needs_review": not best or best.score < 0.72,
            "language": recognized_fields.get("language") or None,
            "recognized_fields": recognized_fields,
            "source_ids": best.card.source_ids.to_json() if best else {},
            "marketplaces": best.to_json()["marketplaces"] if best else {},
            "evidence": best.evidence if best else {},
            "candidates": [candidate.to_json() for candidate in self.candidates],
            "ocr": self.ocr.to_json(),
        }


def result_from_reranked(
    reranked: list[RerankedMatch],
    ocr: OcrFeatures | None = None,
    limit: int = 8,
) -> RecognitionResult:
    features = ocr or OcrFeatures()
    candidates = [
        RecognitionCandidate(
            card=item.match.card,
            score=item.score,
            evidence=item.feature_scores.to_json(),
            rank=index,
        )
        for index, item in enumerate(reranked[:limit], start=1)
    ]
    return RecognitionResult(candidates=candidates, ocr=features)


def recognized_fields_json(card: CardMetadata | None, ocr: OcrFeatures) -> dict[str, str]:
    if not card:
        return {}

    return {
        "name": ocr.name.text or card.name,
        "collector_number": ocr.collector_number.text or card.collector_number,
        "set_id": card.set_id,
        "set_name": card.set_name,
        "variant_class": card.variant_class,
        "language": ocr.language.text or card.language,
    }
