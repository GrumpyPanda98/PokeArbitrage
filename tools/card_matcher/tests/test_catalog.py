from __future__ import annotations

from pathlib import Path

from card_matcher.catalog import load_catalog_cards, upsert_cards
from card_matcher.models import CardMetadata


def test_catalog_round_trips_card_metadata(tmp_path: Path) -> None:
    path = tmp_path / "catalog.sqlite3"
    card = CardMetadata(
        id="sv2a-084",
        name="Pikachu",
        set_id="SV2a",
        set_name="Pokemon Card 151",
        local_id="084",
        image_url="https://example.test/card.webp",
        image_path="cache/images/ja/sv2a-084.webp",
        language="ja",
        printed_total="165",
        variant_class="holo",
    )

    assert upsert_cards(path, [card]) == 1
    cards = load_catalog_cards(path)

    assert len(cards) == 1
    assert cards[0].canonical_print_uid == "ja:sv2a:084:holo"
    assert cards[0].printed_total == "165"
