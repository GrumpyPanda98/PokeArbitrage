from __future__ import annotations

from card_matcher.identity import (
    canonical_print_uid,
    marketplace_queries,
    normalize_collector_number,
)


def test_canonical_print_uid_uses_language_set_number_and_variant() -> None:
    assert (
        canonical_print_uid(
            language="JA",
            set_id="SV2a",
            collector_number=" 084 / 165 ",
            variant_class="Holo Foil",
        )
        == "ja:sv2a:084/165:holo"
    )


def test_collector_number_remains_a_string() -> None:
    assert normalize_collector_number(" 001/165 ") == "001/165"
    assert normalize_collector_number("PROMO-25") == "PROMO-25"


def test_marketplace_queries_do_not_require_marketplace_ids() -> None:
    queries = marketplace_queries(
        name="Pikachu",
        set_name="Test Set",
        collector_number="025/165",
        variant_class="reverse",
    )

    assert queries["north_america"]["query"] == "Pikachu Test Set 025/165 reverse"
    assert queries["europe"]["query"] == "Pikachu 025/165 Test Set"
