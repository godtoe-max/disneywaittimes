"""
Database setup, schema definitions, migrations, and connection helpers.
"""

import os
import sqlite3
from contextlib import contextmanager
from typing import Generator

DB_PATH = os.environ.get("DB_PATH", os.path.join(os.path.dirname(os.path.dirname(__file__)), "disney_wait_times.db"))

DEFAULT_PARKS = [
    (6, "Magic Kingdom", "Walt Disney World", "America/New_York"),
    (5, "EPCOT", "Walt Disney World", "America/New_York"),
    (7, "Disney's Hollywood Studios", "Walt Disney World", "America/New_York"),
    (8, "Disney's Animal Kingdom", "Walt Disney World", "America/New_York"),
    (16, "Disneyland Park", "Disneyland Resort", "America/Los_Angeles"),
    (17, "Disney California Adventure", "Disneyland Resort", "America/Los_Angeles"),
]

def get_connection() -> sqlite3.Connection:
    """Create a configured SQLite connection."""
    conn = sqlite3.connect(DB_PATH, timeout=20.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL;")
    conn.execute("PRAGMA busy_timeout = 5000;")
    conn.execute("PRAGMA foreign_keys = ON;")
    return conn

@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    """Context manager for SQLite database transactions."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()

def init_db() -> None:
    """Initialize database tables and required indices."""
    with get_db() as conn:
        cursor = conn.cursor()
        
        # 1. Parks table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS parks (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                resort TEXT NOT NULL DEFAULT 'Walt Disney World',
                timezone TEXT NOT NULL DEFAULT 'America/New_York'
            );
        """)

        # Migration: Ensure resort and timezone columns exist
        cursor.execute("PRAGMA table_info(parks)")
        existing_cols = {row[1] for row in cursor.fetchall()}
        if "resort" not in existing_cols:
            cursor.execute("ALTER TABLE parks ADD COLUMN resort TEXT NOT NULL DEFAULT 'Walt Disney World'")
        if "timezone" not in existing_cols:
            cursor.execute("ALTER TABLE parks ADD COLUMN timezone TEXT NOT NULL DEFAULT 'America/New_York'")

        # 2. Lands table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS lands (
                id INTEGER PRIMARY KEY,
                park_id INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
                name TEXT NOT NULL
            );
        """)

        # 3. Rides table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS rides (
                id INTEGER PRIMARY KEY,
                land_id INTEGER REFERENCES lands(id) ON DELETE SET NULL,
                park_id INTEGER NOT NULL REFERENCES parks(id) ON DELETE CASCADE,
                name TEXT NOT NULL
            );
        """)

        # 4. Wait times time-series table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS wait_times (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ride_id INTEGER NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
                timestamp_utc TEXT NOT NULL,
                wait_time_minutes INTEGER NOT NULL,
                is_open BOOLEAN NOT NULL,
                actual_wait_minutes INTEGER
            );
        """)

        # Migration: ensure actual_wait_minutes exists if table was created previously
        cursor.execute("PRAGMA table_info(wait_times);")
        columns = [col[1] for col in cursor.fetchall()]
        if "actual_wait_minutes" not in columns:
            cursor.execute("ALTER TABLE wait_times ADD COLUMN actual_wait_minutes INTEGER;")

        # 5. Daily resort metadata table (from TouringPlans historical calendar)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS daily_metadata (
                date TEXT PRIMARY KEY,
                season TEXT,
                holiday TEXT,
                day_of_week INTEGER,
                mk_open TEXT,
                mk_close TEXT,
                ep_open TEXT,
                ep_close TEXT,
                hs_open TEXT,
                hs_close TEXT,
                ak_open TEXT,
                ak_close TEXT,
                dl_open TEXT,
                dl_close TEXT,
                dca_open TEXT,
                dca_close TEXT,
                weather_high REAL,
                weather_low REAL,
                weather_precip REAL,
                school_in_session_pct REAL
            );
        """)

        # Migration: Ensure Disneyland park hours exist in daily_metadata
        cursor.execute("PRAGMA table_info(daily_metadata)")
        meta_cols = {row[1] for row in cursor.fetchall()}
        for col in ["dl_open", "dl_close", "dca_open", "dca_close"]:
            if col not in meta_cols:
                cursor.execute(f"ALTER TABLE daily_metadata ADD COLUMN {col} TEXT")

        # 6. Indices for high performance queries
        cursor.execute("""
            CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_ride_timestamp
            ON wait_times (ride_id, timestamp_utc);
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_wait_times_ride_timestamp
            ON wait_times (ride_id, timestamp_utc);
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_wait_times_timestamp
            ON wait_times (timestamp_utc);
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_rides_park
            ON rides (park_id);
        """)

        cursor.execute("""
            CREATE INDEX IF NOT EXISTS idx_lands_park
            ON lands (park_id);
        """)

        # 7. Seed/Update default parks with resort and timezone
        for p_id, p_name, p_resort, p_tz in DEFAULT_PARKS:
            cursor.execute("""
                INSERT INTO parks (id, name, resort, timezone)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    resort = excluded.resort,
                    timezone = excluded.timezone;
            """, (p_id, p_name, p_resort, p_tz))

if __name__ == "__main__":
    init_db()
    print("Database initialized successfully at:", DB_PATH)
