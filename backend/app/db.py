"""SQLite-Persistenz für Sammlung (Watchlist) und Depotpositionen."""

from __future__ import annotations

import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS collection (
    symbol      TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    asset_class TEXT NOT NULL,
    added_at    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS positions (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol     TEXT NOT NULL,
    quantity   REAL NOT NULL CHECK (quantity > 0),
    price      REAL NOT NULL CHECK (price >= 0),
    bought_on  TEXT,
    created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_positions_symbol ON positions(symbol);
"""


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    def __init__(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(SCHEMA)
        self._lock = threading.Lock()

    def _query(self, sql: str, args: tuple = ()) -> list[dict]:
        with self._lock:
            return [dict(r) for r in self._conn.execute(sql, args).fetchall()]

    def _execute(self, sql: str, args: tuple = ()) -> int:
        with self._lock, self._conn:
            cur = self._conn.execute(sql, args)
            return cur.lastrowid if cur.lastrowid else cur.rowcount

    # Sammlung
    def collection(self) -> list[dict]:
        return self._query("SELECT * FROM collection ORDER BY added_at")

    def add_to_collection(self, symbol: str, name: str, asset_class: str) -> None:
        self._execute(
            "INSERT INTO collection(symbol, name, asset_class, added_at) VALUES (?,?,?,?) "
            "ON CONFLICT(symbol) DO UPDATE SET name=excluded.name, asset_class=excluded.asset_class",
            (symbol, name, asset_class, _now()))

    def remove_from_collection(self, symbol: str) -> int:
        return self._execute("DELETE FROM collection WHERE symbol=?", (symbol,))

    # Positionen
    def positions(self) -> list[dict]:
        return self._query("SELECT * FROM positions ORDER BY symbol, id")

    def add_position(self, symbol: str, quantity: float, price: float, bought_on: str | None) -> int:
        return self._execute(
            "INSERT INTO positions(symbol, quantity, price, bought_on, created_at) VALUES (?,?,?,?,?)",
            (symbol, quantity, price, bought_on, _now()))

    def delete_position(self, position_id: int) -> int:
        return self._execute("DELETE FROM positions WHERE id=?", (position_id,))

    def delete_positions_for(self, symbol: str) -> int:
        return self._execute("DELETE FROM positions WHERE symbol=?", (symbol,))
