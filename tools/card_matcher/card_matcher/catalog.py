from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Iterable

from .models import CardMetadata


CATALOG_SCHEMA_VERSION = 1


def catalog_path(cache_dir: str | Path) -> Path:
    return Path(cache_dir) / "catalog.sqlite3"


def initialize_catalog(path: str | Path) -> None:
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(destination) as connection:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """,
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS cards (
                canonical_print_uid TEXT PRIMARY KEY,
                id TEXT NOT NULL,
                name TEXT NOT NULL,
                language TEXT NOT NULL,
                set_id TEXT NOT NULL,
                set_name TEXT NOT NULL,
                collector_number TEXT NOT NULL,
                printed_total TEXT NOT NULL DEFAULT '',
                variant_class TEXT NOT NULL DEFAULT 'standard',
                image_url TEXT NOT NULL DEFAULT '',
                image_path TEXT NOT NULL DEFAULT '',
                tcgdex_id TEXT NOT NULL DEFAULT '',
                pokemon_tcg_api_id TEXT NOT NULL DEFAULT '',
                marketplace_url TEXT NOT NULL DEFAULT '',
                payload_json TEXT NOT NULL
            )
            """,
        )
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_cards_lookup
            ON cards(language, set_id, collector_number)
            """,
        )
        connection.execute(
            "INSERT OR REPLACE INTO metadata(key, value) VALUES(?, ?)",
            ("schema_version", str(CATALOG_SCHEMA_VERSION)),
        )


def upsert_cards(path: str | Path, cards: Iterable[CardMetadata]) -> int:
    initialize_catalog(path)
    rows = [card_row(card) for card in cards]
    with sqlite3.connect(path) as connection:
        connection.executemany(
            """
            INSERT OR REPLACE INTO cards(
                canonical_print_uid,
                id,
                name,
                language,
                set_id,
                set_name,
                collector_number,
                printed_total,
                variant_class,
                image_url,
                image_path,
                tcgdex_id,
                pokemon_tcg_api_id,
                marketplace_url,
                payload_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows)


def load_catalog_cards(path: str | Path) -> list[CardMetadata]:
    if not Path(path).exists():
        return []

    with sqlite3.connect(path) as connection:
        rows = connection.execute(
            "SELECT payload_json FROM cards ORDER BY language, set_id, collector_number",
        ).fetchall()
    return [CardMetadata.from_json(json.loads(row[0])) for row in rows]


def card_row(card: CardMetadata) -> tuple[str, ...]:
    payload = card.to_json()
    return (
        card.canonical_print_uid,
        card.id,
        card.name,
        card.language,
        card.set_id,
        card.set_name,
        card.collector_number,
        card.printed_total,
        card.variant_class,
        card.image_url,
        card.image_path,
        card.tcgdex_id or card.id,
        card.pokemon_tcg_api_id,
        card.marketplace_url,
        json.dumps(payload, ensure_ascii=False, sort_keys=True),
    )
