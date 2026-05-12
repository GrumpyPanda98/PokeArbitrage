from __future__ import annotations

import json
from dataclasses import dataclass
from dataclasses import replace
from pathlib import Path

from .models import CardMetadata, ImageFingerprint


INDEX_VERSION = 1


@dataclass(frozen=True)
class CardIndex:
    cards: list[CardMetadata]
    fingerprints: list[ImageFingerprint]
    language: str

    @property
    def by_id(self) -> dict[str, CardMetadata]:
        return {card.id: card for card in self.cards}


def index_path(cache_dir: str | Path, language: str) -> Path:
    return Path(cache_dir) / f"{language}_image_index.json"


def load_index(path: str | Path) -> CardIndex:
    index_file = Path(path)
    value = json.loads(index_file.read_text(encoding="utf-8"))
    if value.get("version") != INDEX_VERSION:
        raise ValueError(f"Unsupported index version: {value.get('version')}")

    cards = [CardMetadata.from_json(item) for item in value.get("cards", [])]
    return CardIndex(
        cards=resolve_relative_image_paths(cards, index_file),
        fingerprints=[
            ImageFingerprint.from_json(item) for item in value.get("fingerprints", [])
        ],
        language=str(value.get("language", "ja")),
    )


def save_index(path: str | Path, index: CardIndex) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(
            {
                "version": INDEX_VERSION,
                "language": index.language,
                "cards": [card.to_json() for card in index.cards],
                "fingerprints": [
                    fingerprint.to_json() for fingerprint in index.fingerprints
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )


def resolve_relative_image_paths(cards: list[CardMetadata], index_file: Path) -> list[CardMetadata]:
    root = index_file.parent.parent
    resolved: list[CardMetadata] = []
    for card in cards:
        image_path = Path(card.image_path)
        if image_path.is_absolute() or image_path.exists():
            resolved.append(card)
            continue

        candidate = root / image_path
        resolved.append(
            replace(card, image_path=str(candidate if candidate.exists() else image_path)),
        )
    return resolved
