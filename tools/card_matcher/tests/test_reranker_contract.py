from __future__ import annotations

from pathlib import Path

from card_matcher.contract import result_from_reranked
from card_matcher.models import CardMetadata, MatchResult
from card_matcher.ocr import OcrFeatures, OcrField
from card_matcher.reranker import rerank_matches


def test_reranker_promotes_exact_collector_number_match(tmp_path: Path) -> None:
    visual_winner = match(card("visual", "Wrong Name", "025", tmp_path), score=0.9)
    number_winner = match(card("number", "Pikachu", "084", tmp_path), score=0.72)
    ocr = OcrFeatures(
        name=OcrField("Pikachu", 0.95),
        collector_number=OcrField("084", 0.96),
        language=OcrField("ja", 0.9),
    )

    reranked = rerank_matches([visual_winner, number_winner], ocr)

    assert reranked[0].match.card.id == "number"


def test_contract_contains_canonical_identity_and_marketplace_queries(tmp_path: Path) -> None:
    ocr = OcrFeatures(
        name=OcrField("Pikachu", 0.95),
        collector_number=OcrField("084", 0.96),
        language=OcrField("ja", 0.9),
    )
    reranked = rerank_matches([match(card("sv2a-084", "Pikachu", "084", tmp_path), 0.91)], ocr)
    result = result_from_reranked(reranked, ocr=ocr).to_json()

    assert result["canonical_print_uid"] == "ja:sv2a:084:standard"
    assert result["needs_review"] is False
    assert result["marketplaces"]["europe"]["query"] == "Pikachu 084 Test Set"


def card(card_id: str, name: str, local_id: str, tmp_path: Path) -> CardMetadata:
    return CardMetadata(
        id=card_id,
        name=name,
        set_id="SV2a",
        set_name="Test Set",
        local_id=local_id,
        image_url="",
        image_path=str(tmp_path / f"{card_id}.webp"),
        language="ja",
    )


def match(card_metadata: CardMetadata, score: float) -> MatchResult:
    return MatchResult(
        card=card_metadata,
        score=score,
        hash_distance=0.0,
        histogram_similarity=score,
        orb_similarity=score,
        crop_used=True,
        embedding_similarity=score,
    )
