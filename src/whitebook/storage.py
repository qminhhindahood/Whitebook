from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA_VERSION = "2"


def connect(data_root: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(data_root / "whitebook.sqlite3")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def initialize_database(data_root: Path) -> None:
    with connect(data_root) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_metadata (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS import_drafts (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                stored_pdf_name TEXT,
                pdf_sha256 TEXT,
                csv_sha256 TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                diagnostics_json TEXT NOT NULL,
                status TEXT NOT NULL,
                editable INTEGER NOT NULL,
                published_package_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS question_regions (
                id TEXT PRIMARY KEY,
                draft_id TEXT NOT NULL REFERENCES import_drafts(id) ON DELETE CASCADE,
                question_index INTEGER NOT NULL,
                ordinal INTEGER NOT NULL,
                page_number INTEGER NOT NULL,
                x REAL NOT NULL,
                y REAL NOT NULL,
                width REAL NOT NULL,
                height REAL NOT NULL,
                confirmed INTEGER NOT NULL,
                UNIQUE(draft_id, question_index, ordinal)
            );

            CREATE TABLE IF NOT EXISTS test_packages (
                id TEXT PRIMARY KEY,
                family_id TEXT NOT NULL,
                revision INTEGER NOT NULL,
                title TEXT NOT NULL,
                original_filename TEXT NOT NULL,
                stored_pdf_name TEXT NOT NULL,
                pdf_sha256 TEXT NOT NULL,
                csv_sha256 TEXT NOT NULL,
                manifest_json TEXT NOT NULL,
                regions_json TEXT NOT NULL,
                question_count INTEGER NOT NULL,
                simulation_eligible INTEGER NOT NULL,
                eligibility_reasons_json TEXT NOT NULL,
                archived INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                UNIQUE(pdf_sha256, csv_sha256)
            );

            CREATE INDEX IF NOT EXISTS idx_package_family
                ON test_packages(family_id, revision);
            """
        )
        connection.execute(
            """
            INSERT INTO app_metadata (key, value) VALUES ('schema_version', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (SCHEMA_VERSION,),
        )
        connection.commit()
