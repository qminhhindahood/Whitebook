from __future__ import annotations

import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = "4"

SCHEMA = """
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
    revision_package_id TEXT,
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
    created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_package_family
    ON test_packages(family_id, revision);

CREATE TABLE IF NOT EXISTS attempt_setups (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES test_packages(id),
    kind TEXT NOT NULL,
    selection_json TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    readiness_json TEXT NOT NULL,
    resume_attempt_id TEXT,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attempts (
    id TEXT PRIMARY KEY,
    package_id TEXT NOT NULL REFERENCES test_packages(id),
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    plan_json TEXT NOT NULL,
    state_json TEXT NOT NULL,
    result_json TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_attempt_updated
    ON attempts(updated_at DESC);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


@contextmanager
def connect(data_root: Path) -> Iterator[sqlite3.Connection]:
    connection = sqlite3.connect(data_root / "whitebook.sqlite3")
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    try:
        yield connection
    finally:
        connection.close()


def initialize_database(data_root: Path) -> None:
    prepare_database(data_root / "whitebook.sqlite3")


def prepare_database(database: Path) -> None:
    """Create the schema and migrate an existing database in place.

    Also used on a staged backup database before it is swapped into the
    runtime, so a restore never replaces the live database with one this
    version cannot serve.
    """

    connection = sqlite3.connect(database)
    try:
        connection.row_factory = sqlite3.Row
        connection.executescript(SCHEMA)
        _migrate_connection(connection)
    finally:
        connection.close()


def migrate_database(data_root: Path) -> None:
    database = data_root / "whitebook.sqlite3"
    if not database.is_file():
        return
    connection = sqlite3.connect(database)
    try:
        connection.row_factory = sqlite3.Row
        _migrate_connection(connection)
    finally:
        connection.close()


def _ensure_unique_family_revision(connection: sqlite3.Connection) -> None:
    """Upgrade idx_package_family to UNIQUE so concurrent publishes of the
    same draft can never insert the same (family_id, revision) twice."""

    indexes = {
        row["name"]: row["unique"]
        for row in connection.execute("PRAGMA index_list(test_packages)")
        if row["origin"] in ("c", "u")
    }
    if indexes.get("idx_package_family"):
        return
    if "idx_package_family" in indexes:
        connection.execute("DROP INDEX idx_package_family")
    try:
        connection.execute(
            "CREATE UNIQUE INDEX idx_package_family ON test_packages(family_id, revision)"
        )
    except sqlite3.IntegrityError:
        # Data written before the constraint may already hold duplicate
        # revisions; keep the plain index rather than block startup.
        connection.execute(
            "CREATE INDEX idx_package_family ON test_packages(family_id, revision)"
        )
    connection.commit()


def _migrate_connection(connection: sqlite3.Connection) -> None:
    """Bring an older database up to the current schema.

    SQLite cannot drop a table constraint, so the historical UNIQUE
    (pdf_sha256, csv_sha256) on test_packages is removed by rebuilding the
    table. Revision rows legitimately repeat the same source hash pair.
    """

    draft_columns = {
        row["name"]
        for row in connection.execute("PRAGMA table_info(import_drafts)")
    }
    if not draft_columns:
        return
    if "revision_package_id" not in draft_columns:
        connection.execute(
            "ALTER TABLE import_drafts ADD COLUMN revision_package_id TEXT"
        )
        connection.commit()

    rebuilds = False
    for index in connection.execute("PRAGMA index_list(test_packages)"):
        if not index["unique"] or index["origin"] != "u":
            continue
        columns = [
            row["name"]
            for row in connection.execute(f"PRAGMA index_info({index['name']!r})")
        ]
        if columns == ["pdf_sha256", "csv_sha256"]:
            rebuilds = True
    if rebuilds:
        # DDL autocommits in the Python sqlite3 legacy mode, so a crash
        # mid-rebuild can leave the helper table behind; drop it first.
        connection.execute("PRAGMA foreign_keys = OFF")
        connection.execute("DROP TABLE IF EXISTS test_packages_migrated")
        connection.execute(
            """
            CREATE TABLE test_packages_migrated (
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
                created_at TEXT NOT NULL
            )
            """
        )
        connection.execute(
            """
            INSERT INTO test_packages_migrated (
                id, family_id, revision, title, original_filename,
                stored_pdf_name, pdf_sha256, csv_sha256, manifest_json,
                regions_json, question_count, simulation_eligible,
                eligibility_reasons_json, archived, created_at
            )
            SELECT id, family_id, revision, title, original_filename,
                stored_pdf_name, pdf_sha256, csv_sha256, manifest_json,
                regions_json, question_count, simulation_eligible,
                eligibility_reasons_json, archived, created_at
            FROM test_packages
            """
        )
        connection.execute("DROP TABLE test_packages")
        connection.execute(
            "ALTER TABLE test_packages_migrated RENAME TO test_packages"
        )
        if connection.execute("PRAGMA foreign_key_check").fetchall():
            raise RuntimeError("Package migration broke foreign keys.")
        connection.commit()
    _ensure_unique_family_revision(connection)
    connection.execute(
        """
        INSERT INTO app_metadata (key, value) VALUES ('schema_version', ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """,
        (SCHEMA_VERSION,),
    )
    connection.commit()
