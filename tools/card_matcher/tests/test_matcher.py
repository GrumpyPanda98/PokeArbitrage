from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from card_matcher.image_ops import color_histogram, perceptual_hashes
from card_matcher.index_store import CardIndex, save_index
from card_matcher.matcher import CardMatcher, hash_score
from card_matcher.models import CardMetadata, ImageFingerprint


def test_hash_score_clamps_distance_to_similarity() -> None:
    assert hash_score(0) == 1
    assert hash_score(64) == 0
    assert hash_score(128) == 0


def test_matcher_prefers_visually_similar_reference(tmp_path: Path) -> None:
    red_path = tmp_path / "red.webp"
    blue_path = tmp_path / "blue.webp"
    query_path = tmp_path / "query.webp"

    red = np.full((586, 420, 3), (20, 20, 210), dtype=np.uint8)
    blue = np.full((586, 420, 3), (210, 20, 20), dtype=np.uint8)
    query = np.full((586, 420, 3), (25, 25, 205), dtype=np.uint8)
    cv2.putText(red, "CARD A", (70, 290), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 4)
    cv2.putText(blue, "CARD B", (70, 290), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 4)
    cv2.putText(query, "CARD A", (70, 290), cv2.FONT_HERSHEY_SIMPLEX, 2, (255, 255, 255), 4)
    cv2.imwrite(str(red_path), red)
    cv2.imwrite(str(blue_path), blue)
    cv2.imwrite(str(query_path), query)

    cards = [
        card("card-a", "Card A", red_path),
        card("card-b", "Card B", blue_path),
    ]
    fingerprints = [fingerprint(item) for item in cards]
    index_path = tmp_path / "index.json"
    save_index(index_path, CardIndex(cards=cards, fingerprints=fingerprints, language="ja"))

    matches = CardMatcher.from_index_path(index_path).match(query_path, top=2)

    assert matches[0].card.id == "card-a"


def card(card_id: str, name: str, image_path: Path) -> CardMetadata:
    return CardMetadata(
        id=card_id,
        name=name,
        set_id="test",
        set_name="Test Set",
        local_id="1",
        image_url="",
        image_path=str(image_path),
        language="ja",
    )


def fingerprint(card_metadata: CardMetadata) -> ImageFingerprint:
    image = cv2.imread(card_metadata.image_path, cv2.IMREAD_COLOR)
    assert image is not None
    phash, dhash = perceptual_hashes(image)
    return ImageFingerprint(
        card_id=card_metadata.id,
        phash=phash,
        dhash=dhash,
        histogram=color_histogram(image),
    )
