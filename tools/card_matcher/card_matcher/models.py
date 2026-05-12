from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .identity import SourceIds, canonical_print_uid, normalize_collector_number


@dataclass(frozen=True)
class CardMetadata:
    id: str
    name: str
    set_id: str
    set_name: str
    local_id: str
    image_url: str
    image_path: str
    language: str
    printed_total: str = ""
    variant_class: str = "standard"
    rarity: str = ""
    regulation_mark: str = ""
    tcgdex_id: str = ""
    pokemon_tcg_api_id: str = ""
    marketplace_url: str = ""

    def to_json(self) -> dict[str, Any]:
        value = asdict(self)
        value["collector_number"] = self.collector_number
        value["canonical_print_uid"] = self.canonical_print_uid
        value["source_ids"] = self.source_ids.to_json()
        return value

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "CardMetadata":
        return cls(
            id=str(value["id"]),
            name=str(value.get("name", "")),
            set_id=str(value.get("set_id", "")),
            set_name=str(value.get("set_name", "")),
            local_id=str(value.get("local_id", "")),
            image_url=str(value.get("image_url", "")),
            image_path=str(value.get("image_path", "")),
            language=str(value.get("language", "ja")),
            printed_total=str(value.get("printed_total", "")),
            variant_class=str(value.get("variant_class", "standard")),
            rarity=str(value.get("rarity", "")),
            regulation_mark=str(value.get("regulation_mark", "")),
            tcgdex_id=str(value.get("tcgdex_id") or value.get("id") or ""),
            pokemon_tcg_api_id=str(value.get("pokemon_tcg_api_id", "")),
            marketplace_url=str(value.get("marketplace_url", "")),
        )

    @property
    def resolved_image_path(self) -> Path:
        return Path(self.image_path)

    @property
    def collector_number(self) -> str:
        return normalize_collector_number(self.local_id)

    @property
    def canonical_print_uid(self) -> str:
        return canonical_print_uid(
            language=self.language,
            set_id=self.set_id,
            collector_number=self.collector_number,
            variant_class=self.variant_class,
        )

    @property
    def source_ids(self) -> SourceIds:
        return SourceIds(
            pokemon_tcg_api_id=self.pokemon_tcg_api_id,
            tcgdex_id=self.tcgdex_id or self.id,
        )


@dataclass(frozen=True)
class ImageFingerprint:
    card_id: str
    phash: str
    dhash: str
    histogram: list[float]

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_json(cls, value: dict[str, Any]) -> "ImageFingerprint":
        return cls(
            card_id=str(value["card_id"]),
            phash=str(value["phash"]),
            dhash=str(value["dhash"]),
            histogram=[float(item) for item in value.get("histogram", [])],
        )


@dataclass(frozen=True)
class MatchResult:
    card: CardMetadata
    score: float
    hash_distance: float
    histogram_similarity: float
    orb_similarity: float
    crop_used: bool
    embedding_similarity: float = 0.0
    crop_label: str = ""

    def to_json(self) -> dict[str, Any]:
        return {
            "card": self.card.to_json(),
            "canonical_print_uid": self.card.canonical_print_uid,
            "score": round(self.score, 5),
            "hash_distance": round(self.hash_distance, 5),
            "histogram_similarity": round(self.histogram_similarity, 5),
            "orb_similarity": round(self.orb_similarity, 5),
            "embedding_similarity": round(self.embedding_similarity, 5),
            "crop_used": self.crop_used,
            "crop_label": self.crop_label,
        }
