"""
Data Ingestion Worker for Disney World Parks.
Polls Queue-Times JSON API every 5 minutes with resilience, retry logic, and SQLite persistence.
"""

import asyncio
import logging
from datetime import datetime, timezone
import httpx
from typing import Dict, Any, List, Optional

from backend.database import get_db, init_db

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [worker] %(message)s",
)
logger = logging.getLogger("worker")

TARGET_PARKS = [
    {"id": 6, "name": "Magic Kingdom", "resort": "Walt Disney World"},
    {"id": 5, "name": "EPCOT", "resort": "Walt Disney World"},
    {"id": 7, "name": "Disney's Hollywood Studios", "resort": "Walt Disney World"},
    {"id": 8, "name": "Disney's Animal Kingdom", "resort": "Walt Disney World"},
    {"id": 16, "name": "Disneyland Park", "resort": "Disneyland Resort"},
    {"id": 17, "name": "Disney California Adventure", "resort": "Disneyland Resort"},
]

QUEUE_TIMES_BASE_URL = "https://queue-times.com/parks/{park_id}/queue_times.json"
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DisneyWaitTimesTracker/1.0"
MAX_RETRIES = 3
TIMEOUT_SECONDS = 15.0

async def fetch_park_data(client: httpx.AsyncClient, park_id: int) -> Optional[Dict[str, Any]]:
    """
    Fetch queue times JSON for a specific park with retry and backoff.
    Gracefully handles rate limits and network errors.
    """
    url = QUEUE_TIMES_BASE_URL.format(park_id=park_id)
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "application/json",
    }

    for attempt in range(1, MAX_RETRIES + 1):
        try:
            response = await client.get(url, headers=headers, timeout=TIMEOUT_SECONDS)
            
            # Handle rate limiting
            if response.status_code == 429:
                retry_after = int(response.headers.get("Retry-After", 2 * attempt))
                logger.warning(f"Rate limited on park {park_id}. Waiting {retry_after}s...")
                await asyncio.sleep(retry_after)
                continue

            response.raise_for_status()
            data = response.json()
            return data

        except (httpx.RequestError, httpx.HTTPStatusError) as exc:
            delay = 2 ** (attempt - 1)
            logger.warning(
                f"Attempt {attempt}/{MAX_RETRIES} failed for park {park_id}: {exc}. Retrying in {delay}s..."
            )
            if attempt < MAX_RETRIES:
                await asyncio.sleep(delay)
            else:
                logger.error(f"Exhausted retries for park {park_id}: {exc}")
                return None
        except Exception as exc:
            logger.error(f"Unexpected error fetching park {park_id}: {exc}", exc_info=True)
            return None

    return None

def ingest_park_payload(park_id: int, payload: Dict[str, Any], current_utc: str) -> Dict[str, int]:
    """
    Process payload and persist lands, rides, and wait_times in SQLite.
    Returns counts of ingested lands and rides.
    """
    lands_count = 0
    rides_count = 0
    open_rides_count = 0

    with get_db() as conn:
        cursor = conn.cursor()

        # Ingest lands and their rides
        lands = payload.get("lands", [])
        for land in lands:
            land_id = land.get("id")
            land_name = land.get("name")
            if not land_id or not land_name:
                continue

            cursor.execute("""
                INSERT INTO lands (id, park_id, name)
                VALUES (?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    park_id = excluded.park_id;
            """, (land_id, park_id, land_name.strip()))
            lands_count += 1

            for ride in land.get("rides", []):
                ride_id = ride.get("id")
                ride_name = ride.get("name")
                if not ride_id or not ride_name:
                    continue

                cursor.execute("""
                    INSERT INTO rides (id, land_id, park_id, name)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        land_id = excluded.land_id,
                        park_id = excluded.park_id;
                """, (ride_id, land_id, park_id, ride_name.strip()))

                is_open = bool(ride.get("is_open", False))
                wait_time = int(ride.get("wait_time") or 0)
                # Use ride's last_updated if provided and valid, otherwise current polling UTC
                obs_time = ride.get("last_updated") or current_utc

                cursor.execute("""
                    INSERT OR IGNORE INTO wait_times (ride_id, timestamp_utc, wait_time_minutes, is_open)
                    VALUES (?, ?, ?, ?);
                """, (ride_id, obs_time, wait_time, 1 if is_open else 0))

                rides_count += 1
                if is_open:
                    open_rides_count += 1

        # Ingest top-level rides not mapped to a land
        top_rides = payload.get("rides", [])
        for ride in top_rides:
            ride_id = ride.get("id")
            ride_name = ride.get("name")
            if not ride_id or not ride_name:
                continue

            cursor.execute("""
                INSERT INTO rides (id, land_id, park_id, name)
                VALUES (?, NULL, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    park_id = excluded.park_id;
            """, (ride_id, park_id, ride_name.strip()))

            is_open = bool(ride.get("is_open", False))
            wait_time = int(ride.get("wait_time") or 0)
            obs_time = ride.get("last_updated") or current_utc

            cursor.execute("""
                INSERT OR IGNORE INTO wait_times (ride_id, timestamp_utc, wait_time_minutes, is_open)
                VALUES (?, ?, ?, ?);
            """, (ride_id, obs_time, wait_time, 1 if is_open else 0))

            rides_count += 1
            if is_open:
                open_rides_count += 1

    return {
        "lands": lands_count,
        "rides": rides_count,
        "open_rides": open_rides_count,
    }

async def poll_all_parks() -> Dict[str, Any]:
    """
    Poll all 4 Disney World parks asynchronously and store observations.
    Returns status report.
    """
    start_time = datetime.now(timezone.utc)
    current_utc_str = start_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    results = {}
    total_rides = 0
    total_open = 0
    errors = []

    async with httpx.AsyncClient() as client:
        tasks = [fetch_park_data(client, park["id"]) for park in TARGET_PARKS]
        payloads = await asyncio.gather(*tasks, return_exceptions=True)

        for park, payload in zip(TARGET_PARKS, payloads):
            park_id = park["id"]
            park_name = park["name"]

            if isinstance(payload, Exception):
                err_msg = f"Exception fetching {park_name}: {payload}"
                logger.error(err_msg)
                errors.append(err_msg)
                continue

            if not payload:
                err_msg = f"No payload received for {park_name} (park_id {park_id})"
                logger.warning(err_msg)
                errors.append(err_msg)
                continue

            try:
                stats = ingest_park_payload(park_id, payload, current_utc_str)
                results[park_name] = stats
                total_rides += stats["rides"]
                total_open += stats["open_rides"]
                logger.info(
                    f"Synced {park_name}: {stats['rides']} rides ({stats['open_rides']} open), {stats['lands']} lands"
                )
            except Exception as exc:
                err_msg = f"DB ingestion error for {park_name}: {exc}"
                logger.error(err_msg, exc_info=True)
                errors.append(err_msg)

    duration = (datetime.now(timezone.utc) - start_time).total_seconds()

    # Enforce rolling retention policy (drop pre-2021 & drop oldest day as new days arrive)
    retention_report = enforce_rolling_retention(max_days_retention=365)

    summary = {
        "timestamp_utc": current_utc_str,
        "duration_seconds": round(duration, 2),
        "total_rides_polled": total_rides,
        "total_rides_open": total_open,
        "parks_synced": results,
        "retention": retention_report,
        "errors": errors,
        "status": "success" if not errors else ("partial" if results else "failed"),
    }
    logger.info(f"Poll cycle completed in {duration:.2f}s. Total rides: {total_rides}, open: {total_open}")
    return summary

def enforce_rolling_retention(max_days_retention: int = 365) -> Dict[str, Any]:
    """
    Enforces rolling data retention policy:
    1. Strictly purges any data older than 2021-01-01.
    2. For every new day of data gathered, drops the oldest day in the database
       to maintain a maximum window of `max_days_retention` (default 365 days / 1 year).
    """
    report = {"pre_2021_deleted": 0, "oldest_days_dropped": []}
    try:
        with get_db() as conn:
            cursor = conn.cursor()

            # 1. Guarantee no legacy data before 2021
            cursor.execute("DELETE FROM wait_times WHERE timestamp_utc < '2021-01-01'")
            report["pre_2021_deleted"] += cursor.rowcount
            cursor.execute("DELETE FROM daily_metadata WHERE date < '2021-01-01'")

            # 2. Count distinct calendar days in wait_times
            cursor.execute("SELECT count(DISTINCT substr(timestamp_utc, 1, 10)) FROM wait_times")
            distinct_days = cursor.fetchone()[0] or 0

            if distinct_days > max_days_retention:
                excess_days = distinct_days - max_days_retention
                cursor.execute("""
                    SELECT DISTINCT substr(timestamp_utc, 1, 10) as day_str
                    FROM wait_times
                    ORDER BY day_str ASC
                    LIMIT ?
                """, (excess_days,))
                oldest_days = [row[0] for row in cursor.fetchall()]

                for old_day in oldest_days:
                    cursor.execute("DELETE FROM wait_times WHERE timestamp_utc LIKE ?", (f"{old_day}%",))
                    deleted_rows = cursor.rowcount
                    cursor.execute("DELETE FROM daily_metadata WHERE date = ?", (old_day,))
                    report["oldest_days_dropped"].append({"date": old_day, "rows_deleted": deleted_rows})
                    logger.info(
                        f"Rolling Retention: Dropped oldest day {old_day} ({deleted_rows} records) "
                        f"to maintain {max_days_retention}-day rolling window."
                    )
            conn.commit()
    except Exception as exc:
        logger.error(f"Error enforcing rolling retention: {exc}", exc_info=True)
    return report

if __name__ == "__main__":
    init_db()
    print("Running on-demand poll...")
    summary = asyncio.run(poll_all_parks())
    print("\nPoll Summary:")
    import json
    print(json.dumps(summary, indent=2))
