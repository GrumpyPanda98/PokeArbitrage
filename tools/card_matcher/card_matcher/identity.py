from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass


DEFAULT_VARIANT_CLASS = "standard"


@dataclass(frozen=True)
class SourceIds:
    pokemon_tcg_api_id: str = ""
    tcgdex_id: str = ""
    tcgplayer_product_id: str = ""
    tcgplayer_group_id: str = ""
    cardmarket_product_ref: str = ""

    def to_json(self) -> dict[str, str | None]:
        return {
            "pokemon_tcg_api_id": self.pokemon_tcg_api_id or None,
            "tcgdex_id": self.tcgdex_id or None,
            "tcgplayer_product_id": self.tcgplayer_product_id or None,
            "tcgplayer_group_id": self.tcgplayer_group_id or None,
            "cardmarket_product_ref": self.cardmarket_product_ref or None,
        }


def canonical_print_uid(
    *,
    language: str,
    set_id: str,
    collector_number: str,
    variant_class: str = DEFAULT_VARIANT_CLASS,
) -> str:
    return ":".join(
        [
            normalize_token(language) or "unknown",
            normalize_token(set_id) or "unknown-set",
            normalize_collector_number(collector_number) or "unknown-number",
            normalize_variant_class(variant_class),
        ],
    )


def normalize_collector_number(value: str | int | None) -> str:
    if value is None:
        return ""

    normalized = unicodedata.normalize("NFKC", str(value)).strip()
    normalized = normalized.replace("\\", "/")
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def normalize_variant_class(value: str | None) -> str:
    normalized = normalize_token(value or DEFAULT_VARIANT_CLASS)
    if normalized in {"normal", "regular", "none"}:
        return DEFAULT_VARIANT_CLASS
    if normalized in {"reverse_holo", "reversefoil", "reverse"}:
        return "reverse"
    if normalized in {"holofoil", "holo_foil", "holo-foil"}:
        return "holo"
    if normalized in {"first_edition", "1st_edition", "firstedition"}:
        return "first-edition"
    return normalized or DEFAULT_VARIANT_CLASS


def normalize_token(value: str | None) -> str:
    if value is None:
        return ""

    normalized = unicodedata.normalize("NFKC", str(value)).strip().lower()
    normalized = re.sub(r"[^a-z0-9/._-]+", "-", normalized)
    normalized = re.sub(r"-+", "-", normalized)
    return normalized.strip("-")


def normalize_search_text(value: str | None) -> str:
    if not value:
        return ""

    normalized = unicodedata.normalize("NFKC", value).casefold()
    normalized = re.sub(r"[^\w\s/.-]+", " ", normalized)
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def marketplace_queries(
    *,
    name: str,
    set_name: str,
    collector_number: str,
    variant_class: str = DEFAULT_VARIANT_CLASS,
    cardmarket_short_code: str = "",
) -> dict[str, dict[str, str | None]]:
    number = normalize_collector_number(collector_number)
    variant = "" if normalize_variant_class(variant_class) == DEFAULT_VARIANT_CLASS else variant_class
    parts = [name, set_name, number, variant]
    north_america = " ".join(part.strip() for part in parts if part and part.strip())

    if cardmarket_short_code and number:
        europe_query = " ".join(
            part for part in [name.strip(), f"{cardmarket_short_code.strip()}{number}"] if part
        )
        europe_mode = "query_or_curated_code"
    else:
        europe_query = " ".join(part.strip() for part in [name, number, set_name] if part and part.strip())
        europe_mode = "query"

    return {
        "north_america": {
            "product_id": None,
            "group_id": None,
            "query": north_america or None,
            "resolution_mode": "query",
        },
        "europe": {
            "product_ref": None,
            "query": europe_query or None,
            "resolution_mode": europe_mode,
        },
    }
