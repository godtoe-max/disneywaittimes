"""
TouringPlans Open Data Importer for Disney World Wait Times Tracker.
Downloads and ingests historical crowd calendars, park hours, posted wait times,
and actual wait times (SACTMIN) from the open TouringPlans research dataset into SQLite.
"""

import os
import csv
import io
import logging
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo
from typing import Dict, Any, List, Optional

from backend.database import get_db, init_db, get_connection

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [touringplans-import] %(message)s",
)
logger = logging.getLogger("touringplans-import")

BASE_GITHUB_RAW = "https://raw.githubusercontent.com/LucyMcGowan/touringplans/master/data-raw"
EASTERN_TZ = ZoneInfo("America/New_York")
UTC_TZ = ZoneInfo("UTC")

# Mapping of TouringPlans CSV filenames to our database ride_id
ATTRACTION_CSV_MAP = [
    {
        "filename": "seven_dwarfs_train.csv",
        "ride_id": 129,
        "name": "Seven Dwarfs Mine Train",
        "park": "Magic Kingdom",
    },
    {
        "filename": "pirates_of_caribbean.csv",
        "ride_id": 137,
        "name": "Pirates of the Caribbean",
        "park": "Magic Kingdom",
    },
    {
        "filename": "spaceship_earth.csv",
        "ride_id": 159,
        "name": "Spaceship Earth",
        "park": "EPCOT",
    },
    {
        "filename": "soarin.csv",
        "ride_id": 16467,
        "name": "Soarin'",
        "park": "EPCOT",
    },
    {
        "filename": "slinky_dog.csv",
        "ride_id": 5476,
        "name": "Slinky Dog Dash",
        "park": "Disney's Hollywood Studios",
    },
    {
        "filename": "alien_saucers.csv",
        "ride_id": 5477,
        "name": "Alien Swirling Saucers",
        "park": "Disney's Hollywood Studios",
    },
    {
        "filename": "toy_story_mania.csv",
        "ride_id": 117,
        "name": "Toy Story Mania!",
        "park": "Disney's Hollywood Studios",
    },
    {
        "filename": "flight_of_passage.csv",
        "ride_id": 4439,
        "name": "Avatar Flight of Passage",
        "park": "Disney's Animal Kingdom",
    },
    {
        "filename": "expedition_everest.csv",
        "ride_id": 110,
        "name": "Expedition Everest",
        "park": "Disney's Animal Kingdom",
    },
    {
        "filename": "kilimanjaro_safaris.csv",
        "ride_id": 113,
        "name": "Kilimanjaro Safaris",
        "park": "Disney's Animal Kingdom",
    },
    {
        "filename": "navi_river.csv",
        "ride_id": 4438,
        "name": "Na'vi River Journey",
        "park": "Disney's Animal Kingdom",
    },
]

def fetch_url_text(url: str, timeout: int = 30) -> str:
    """Fetch text content from URL with custom User-Agent."""
    req = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DisneyWaitTimesTracker/1.0"}
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", errors="ignore")

def import_metadata() -> int:
    """
    Download and ingest touringplans_metadata.csv into daily_metadata table.
    Stores historical park hours, holiday crowd markers, weather, and school sessions.
    """
    url = f"{BASE_GITHUB_RAW}/touringplans_metadata.csv"
    logger.info(f"Downloading TouringPlans resort metadata from {url}...")
    try:
        raw_csv = fetch_url_text(url)
    except Exception as exc:
        logger.error(f"Failed to fetch metadata CSV: {exc}")
        return 0

    reader = csv.DictReader(io.StringIO(raw_csv))
    rows_to_insert = []

    for row in reader:
        date_str = row.get("DATE", "").strip()
        if not date_str:
            continue

        # Convert MM/DD/YYYY to YYYY-MM-DD
        try:
            parsed_date = datetime.strptime(date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
        except Exception:
            parsed_date = date_str

        season = row.get("WDWSEASON") or row.get("SEASON") or ""
        holiday = row.get("HOLIDAY") or ""
        day_of_week = int(row.get("DAYOFWEEK", 0) or 0)

        mk_open = row.get("MKOPEN", "")
        mk_close = row.get("MKCLOSE", "")
        ep_open = row.get("EPOPEN", "")
        ep_close = row.get("EPCLOSE", "")
        hs_open = row.get("HSOPEN", "")
        hs_close = row.get("HSCLOSE", "")
        ak_open = row.get("AKOPEN", "")
        ak_close = row.get("AKCLOSE", "")

        def parse_float(val: Optional[str]) -> Optional[float]:
            if not val:
                return None
            try:
                return float(val.replace("%", "").strip())
            except Exception:
                return None

        w_high = parse_float(row.get("WEATHER_WDWHIGH"))
        w_low = parse_float(row.get("WEATHER_WDWLOW"))
        w_precip = parse_float(row.get("WEATHER_WDWPRECIP"))
        in_session = parse_float(row.get("inSession_Florida") or row.get("inSession_wdw"))

        rows_to_insert.append((
            parsed_date,
            season,
            holiday,
            day_of_week,
            mk_open,
            mk_close,
            ep_open,
            ep_close,
            hs_open,
            hs_close,
            ak_open,
            ak_close,
            w_high,
            w_low,
            w_precip,
            in_session,
        ))

    if rows_to_insert:
        with get_db() as db:
            db.executemany("""
                INSERT OR REPLACE INTO daily_metadata (
                    date, season, holiday, day_of_week,
                    mk_open, mk_close, ep_open, ep_close,
                    hs_open, hs_close, ak_open, ak_close,
                    weather_high, weather_low, weather_precip,
                    school_in_session_pct
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
            """, rows_to_insert)
        logger.info(f"Ingested {len(rows_to_insert)} daily metadata records.")

    return len(rows_to_insert)

def import_attraction_csv(item: Dict[str, Any], sample_interval_mins: int = 15) -> int:
    """
    Download and ingest an attraction wait times CSV.
    Extracts posted wait, actual wait (SACTMIN), and offline downtime flags.
    """
    filename = item["filename"]
    ride_id = item["ride_id"]
    ride_name = item["name"]
    park_name = item["park"]

    url = f"{BASE_GITHUB_RAW}/{filename}"
    logger.info(f"Fetching {ride_name} ({park_name}) from {url}...")

    try:
        raw_csv = fetch_url_text(url)
    except Exception as exc:
        logger.error(f"Failed to fetch {filename}: {exc}")
        return 0

    reader = csv.DictReader(io.StringIO(raw_csv))
    rows_to_insert = []
    last_sampled_dt: Optional[datetime] = None

    for row in reader:
        dt_str = row.get("datetime", "").strip()
        if not dt_str:
            continue

        try:
            # Format: YYYY-MM-DD HH:MM:SS (Eastern time)
            local_dt = datetime.strptime(dt_str, "%Y-%m-%d %H:%M:%S").replace(tzinfo=EASTERN_TZ)
        except Exception:
            continue

        # Sampling filter to ensure optimal query performance
        if sample_interval_mins > 0 and last_sampled_dt:
            delta_mins = (local_dt - last_sampled_dt).total_seconds() / 60.0
            # If less than interval, skip unless actual wait is present
            has_actual = bool(row.get("SACTMIN") and row.get("SACTMIN").strip())
            if delta_mins < sample_interval_mins and not has_actual:
                continue

        last_sampled_dt = local_dt

        # Convert to UTC ISO8601 string
        utc_dt = local_dt.astimezone(UTC_TZ)
        utc_iso = utc_dt.strftime("%Y-%m-%dT%H:%M:%SZ")

        spost_raw = row.get("SPOSTMIN", "").strip()
        sact_raw = row.get("SACTMIN", "").strip()

        actual_wait: Optional[int] = None
        if sact_raw:
            try:
                actual_wait = int(round(float(sact_raw)))
            except Exception:
                pass

        posted_wait: int = 0
        is_open: int = 1

        if spost_raw:
            try:
                val = float(spost_raw)
                if val == -999 or val < 0:
                    is_open = 0
                    posted_wait = 0
                else:
                    is_open = 1
                    posted_wait = int(round(val))
            except Exception:
                is_open = 1
                posted_wait = 0
        elif actual_wait is not None:
            # If posted is missing but actual is present
            is_open = 1
            posted_wait = actual_wait
        else:
            continue

        rows_to_insert.append((
            ride_id,
            utc_iso,
            posted_wait,
            is_open,
            actual_wait,
        ))

    if rows_to_insert:
        with get_db() as db:
            db.executemany("""
                INSERT OR IGNORE INTO wait_times (
                    ride_id, timestamp_utc, wait_time_minutes, is_open, actual_wait_minutes
                ) VALUES (?, ?, ?, ?, ?);
            """, rows_to_insert)

        logger.info(f"Imported {len(rows_to_insert)} historical points for {ride_name}.")

    return len(rows_to_insert)

def run_import(sample_interval_mins: int = 15) -> Dict[str, Any]:
    """
    Run full import of TouringPlans metadata and all mapped attraction datasets.
    """
    init_db()
    meta_count = import_metadata()

    attraction_results = {}
    total_points = 0

    for item in ATTRACTION_CSV_MAP:
        count = import_attraction_csv(item, sample_interval_mins=sample_interval_mins)
        attraction_results[item["name"]] = count
        total_points += count

    summary = {
        "metadata_days_imported": meta_count,
        "attractions_imported": len(attraction_results),
        "total_wait_points_imported": total_points,
        "breakdown": attraction_results,
    }
    logger.info(f"TouringPlans Import Complete! Total points: {total_points}, Metadata days: {meta_count}")
    return summary

if __name__ == "__main__":
    import json
    print("Starting TouringPlans Historical Data Import...")
    summary = run_import(sample_interval_mins=15)
    print("\nImport Summary:")
    print(json.dumps(summary, indent=2))
