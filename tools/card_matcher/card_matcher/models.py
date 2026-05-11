from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


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

    def to_json(self) -> dict[str, Any]:
        return asdict(self)

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
        )

    @property
    def resolved_image_path(self) -> Path:
        return Path(self.image_path)


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

    def to_json(self) -> dict[str, Any]:
        return {
            "card": self.card.to_json(),
            "score": round(self.score, 5),
            "hash_distance": round(self.hash_distance, 5),
            "histogram_similarity": round(self.histogram_similarity, 5),
            "orb_similarity": round(self.orb_similarity, 5),
            "embedding_similarity": round(self.embedding_similarity, 5),
            "crop_used": self.crop_used,
        }
