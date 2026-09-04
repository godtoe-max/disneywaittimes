"""
Analytics, query services, and historical aggregation calculations for Disney World wait times.
"""

from datetime import datetime, timezone, timedelta
from typing import Dict, Any, List, Optional
import random

from backend.database import get_connection, get_db

# Disney World parks operating timezone offset (US Eastern, UTC-4 during EDT, UTC-5 during EST)
EDT_OFFSET_HOURS = -4
# Disneyland Resort operating timezone offset (US Pacific, UTC-7 during PDT, UTC-8 during PST)
PDT_OFFSET_HOURS = -7

def get_park_utc_offset(park_id: int) -> int:
    """Return local standard/daylight UTC offset in hours."""
    return PDT_OFFSET_HOURS if park_id in (16, 17) else EDT_OFFSET_HOURS

def calculate_crowd_level(avg_wait: float, park_id: Optional[int] = None) -> Dict[str, Any]:
    """
    Classify crowd intensity into:
    - EMPTY: Ghost town / walk-on conditions (< 20 min or < 60% of baseline)
    - LIGHT: Below normal wait times (20–32 min or 60%–85% of baseline)
    - NORMAL: Typical / moderate volume (33–46 min or 85%–115% of baseline)
    - BUSY: Heavy / peak wait times (> 46 min or > 115% of baseline)
    """
    baseline = 36.0
    if park_id in (6, 16):  # Magic Kingdom, Disneyland
        baseline = 38.0
    elif park_id in (7, 17):  # Hollywood Studios, DCA
        baseline = 40.0
    elif park_id in (5, 8):  # EPCOT, Animal Kingdom
        baseline = 32.0

    ratio = (avg_wait / baseline) if baseline > 0 else 1.0

    if avg_wait < 18 or ratio < 0.60:
        return {
            "level": "empty",
            "tier": "EMPTY",
            "label": "Empty / Walk-on",
            "badge_text": "🟢 Empty (Walk-on)",
            "score": 1,
            "color": "#10b981",
            "bg_color": "rgba(16, 185, 129, 0.15)",
            "icon": "🟢",
            "description": "Near-zero lines across most attractions! Exceptional walk-on conditions.",
            "pct_of_normal": round(ratio * 100, 1),
        }
    elif avg_wait < 33 or ratio < 0.85:
        return {
            "level": "light",
            "tier": "LIGHT",
            "label": "Light Crowds",
            "badge_text": "🔵 Light (Below Normal)",
            "score": 2,
            "color": "#06b6d4",
            "bg_color": "rgba(6, 182, 212, 0.15)",
            "icon": "🔵",
            "description": "Significantly shorter lines than usual. Great day for standby riding without long waits.",
            "pct_of_normal": round(ratio * 100, 1),
        }
    elif avg_wait < 47 or ratio <= 1.18:
        return {
            "level": "normal",
            "tier": "NORMAL",
            "label": "Normal / Moderate",
            "badge_text": "🟡 Normal (Typical)",
            "score": 3,
            "color": "#f59e0b",
            "bg_color": "rgba(245, 158, 11, 0.15)",
            "icon": "🟡",
            "description": "Standard crowd volume. Headliners have typical lines, secondary rides are manageable.",
            "pct_of_normal": round(ratio * 100, 1),
        }
    else:
        return {
            "level": "busy",
            "tier": "BUSY",
            "label": "Busy / Heavy",
            "badge_text": "🔴 Busy (Heavy Queues)",
            "score": 4,
            "color": "#ef4444",
            "bg_color": "rgba(239, 68, 68, 0.15)",
            "icon": "🔴",
            "description": "Heavy wait times across major attractions. Lightning Lane or rope drop strategy strongly advised.",
            "pct_of_normal": round(ratio * 100, 1),
        }

def get_parks_summary() -> List[Dict[str, Any]]:
    """
    Get high-level summary cards for each park with live wait averages,
    open ride count, down count, and highest wait attraction.
    """
    conn = get_connection()
    try:
        # Get latest observation per ride
        query = """
            WITH latest_obs AS (
                SELECT wt.ride_id, wt.wait_time_minutes, wt.is_open, wt.timestamp_utc,
                       ROW_NUMBER() OVER (PARTITION BY wt.ride_id ORDER BY wt.timestamp_utc DESC) as rn
                FROM wait_times wt
            )
            SELECT 
                p.id as park_id,
                p.name as park_name,
                COALESCE(p.resort, 'Walt Disney World') as resort,
                COALESCE(p.timezone, 'America/New_York') as timezone,
                COUNT(r.id) as total_rides,
                SUM(CASE WHEN lo.is_open = 1 THEN 1 ELSE 0 END) as open_rides,
                SUM(CASE WHEN lo.is_open = 0 THEN 1 ELSE 0 END) as down_rides,
                ROUND(AVG(CASE WHEN lo.is_open = 1 THEN lo.wait_time_minutes ELSE NULL END), 1) as avg_wait_time,
                MAX(CASE WHEN lo.is_open = 1 THEN lo.wait_time_minutes ELSE 0 END) as max_wait_time,
                MAX(lo.timestamp_utc) as last_updated
            FROM parks p
            LEFT JOIN rides r ON r.park_id = p.id
            LEFT JOIN latest_obs lo ON lo.ride_id = r.id AND lo.rn = 1
            GROUP BY p.id, p.name, p.resort, p.timezone
            ORDER BY p.id;
        """
        rows = conn.execute(query).fetchall()
        
        parks_list = []
        for r in rows:
            park_id = r["park_id"]
            avg_wait = r["avg_wait_time"] if r["avg_wait_time"] is not None else 0
            
            # Find the ride with the highest wait time in this park
            top_ride_row = conn.execute("""
                WITH latest_obs AS (
                    SELECT wt.ride_id, wt.wait_time_minutes, wt.is_open,
                           ROW_NUMBER() OVER (PARTITION BY wt.ride_id ORDER BY wt.timestamp_utc DESC) as rn
                    FROM wait_times wt
                )
                SELECT r.name, lo.wait_time_minutes
                FROM rides r
                JOIN latest_obs lo ON lo.ride_id = r.id AND lo.rn = 1
                WHERE r.park_id = ? AND lo.is_open = 1
                ORDER BY lo.wait_time_minutes DESC
                LIMIT 1;
            """, (park_id,)).fetchone()

            top_ride_name = top_ride_row["name"] if top_ride_row else "None"
            top_ride_wait = top_ride_row["wait_time_minutes"] if top_ride_row else 0
            
            crowd_info = calculate_crowd_level(avg_wait, park_id)

            parks_list.append({
                "id": park_id,
                "name": r["park_name"],
                "resort": r["resort"] if "resort" in r.keys() else ("Disneyland Resort" if park_id in (16, 17) else "Walt Disney World"),
                "timezone": r["timezone"] if "timezone" in r.keys() else ("America/Los_Angeles" if park_id in (16, 17) else "America/New_York"),
                "total_rides": r["total_rides"] or 0,
                "open_rides": r["open_rides"] or 0,
                "down_rides": r["down_rides"] or 0,
                "avg_wait_time": avg_wait,
                "max_wait_time": top_ride_wait,
                "top_ride_name": top_ride_name,
                "crowd_level": crowd_info,
                "last_updated": r["last_updated"],
            })
            
        return parks_list
    finally:
        conn.close()

def get_park_live_waits(park_id: int) -> Optional[Dict[str, Any]]:
    """
    Get detailed live wait times for a specific park, organized by land.
    """
    conn = get_connection()
    try:
        park_row = conn.execute("SELECT id, name FROM parks WHERE id = ?", (park_id,)).fetchone()
        if not park_row:
            return None

        # Fetch lands
        lands_rows = conn.execute(
            "SELECT id, name FROM lands WHERE park_id = ? ORDER BY name ASC",
            (park_id,)
        ).fetchall()

        # Fetch latest wait times for all rides in this park
        query = """
            WITH latest_obs AS (
                SELECT wt.ride_id, wt.wait_time_minutes, wt.is_open, wt.timestamp_utc,
                       ROW_NUMBER() OVER (PARTITION BY wt.ride_id ORDER BY wt.timestamp_utc DESC) as rn
                FROM wait_times wt
            )
            SELECT 
                r.id as ride_id,
                r.land_id,
                r.name as ride_name,
                COALESCE(lo.wait_time_minutes, 0) as wait_time,
                COALESCE(lo.is_open, 0) as is_open,
                lo.timestamp_utc
            FROM rides r
            LEFT JOIN latest_obs lo ON lo.ride_id = r.id AND lo.rn = 1
            WHERE r.park_id = ?
            ORDER BY r.name ASC;
        """
        rides_rows = conn.execute(query, (park_id,)).fetchall()

        # Group rides by land_id
        lands_map = {l["id"]: {"id": l["id"], "name": l["name"], "rides": []} for l in lands_rows}
        unassigned_rides = []

        total_open = 0
        total_wait_minutes = 0

        for rr in rides_rows:
            ride_data = {
                "id": rr["ride_id"],
                "name": rr["ride_name"],
                "land_id": rr["land_id"],
                "wait_time": rr["wait_time"],
                "is_open": bool(rr["is_open"]),
                "last_updated": rr["timestamp_utc"],
            }
            if rr["is_open"]:
                total_open += 1
                total_wait_minutes += rr["wait_time"]

            if rr["land_id"] in lands_map:
                lands_map[rr["land_id"]]["rides"].append(ride_data)
            else:
                unassigned_rides.append(ride_data)

        lands_list = list(lands_map.values())
        if unassigned_rides:
            lands_list.append({
                "id": None,
                "name": "General / Park-wide",
                "rides": unassigned_rides,
            })

        avg_wait = round(total_wait_minutes / total_open, 1) if total_open > 0 else 0
        crowd_info = calculate_crowd_level(avg_wait, park_id)

        return {
            "park_id": park_row["id"],
            "park_name": park_row["name"],
            "total_rides": len(rides_rows),
            "open_rides": total_open,
            "down_rides": len(rides_rows) - total_open,
            "avg_wait_time": avg_wait,
            "crowd_level": crowd_info,
            "lands": lands_list,
        }
    finally:
        conn.close()

def get_all_rides(
    park_id: Optional[int] = None,
    search: Optional[str] = None,
    open_only: Optional[bool] = None,
) -> List[Dict[str, Any]]:
    """
    Search and filter attractions across all parks with live statuses.
    """
    conn = get_connection()
    try:
        conditions = ["1=1"]
        params: List[Any] = []

        if park_id:
            conditions.append("r.park_id = ?")
            params.append(park_id)

        if search:
            conditions.append("r.name LIKE ?")
            params.append(f"%{search.strip()}%")

        where_clause = " AND ".join(conditions)

        query = f"""
            WITH latest_obs AS (
                SELECT wt.ride_id, wt.wait_time_minutes, wt.is_open, wt.timestamp_utc,
                       ROW_NUMBER() OVER (PARTITION BY wt.ride_id ORDER BY wt.timestamp_utc DESC) as rn
                FROM wait_times wt
            )
            SELECT 
                r.id as ride_id,
                r.name as ride_name,
                r.park_id,
                p.name as park_name,
                r.land_id,
                COALESCE(l.name, 'General') as land_name,
                COALESCE(lo.wait_time_minutes, 0) as wait_time,
                COALESCE(lo.is_open, 0) as is_open,
                lo.timestamp_utc
            FROM rides r
            JOIN parks p ON r.park_id = p.id
            LEFT JOIN lands l ON r.land_id = l.id
            LEFT JOIN latest_obs lo ON lo.ride_id = r.id AND lo.rn = 1
            WHERE {where_clause}
            ORDER BY lo.wait_time_minutes DESC, r.name ASC;
        """
        rows = conn.execute(query, params).fetchall()

        results = []
        for r in rows:
            is_open = bool(r["is_open"])
            if open_only is True and not is_open:
                continue
            if open_only is False and is_open:
                continue

            results.append({
                "id": r["ride_id"],
                "name": r["ride_name"],
                "park_id": r["park_id"],
                "park_name": r["park_name"],
                "land_id": r["land_id"],
                "land_name": r["land_name"],
                "wait_time": r["wait_time"],
                "is_open": is_open,
                "last_updated": r["timestamp_utc"],
            })
        return results
    finally:
        conn.close()

def get_current_downtimes() -> List[Dict[str, Any]]:
    """
    Identify current downtimes across all parks (rides where is_open = false).
    Computes downtime duration based on the earliest consecutive closed observation.
    """
    conn = get_connection()
    try:
        query = """
            WITH latest_obs AS (
                SELECT wt.ride_id, wt.wait_time_minutes, wt.is_open, wt.timestamp_utc,
                       ROW_NUMBER() OVER (PARTITION BY wt.ride_id ORDER BY wt.timestamp_utc DESC) as rn
                FROM wait_times wt
            )
            SELECT 
                r.id as ride_id,
                r.name as ride_name,
                p.id as park_id,
                p.name as park_name,
                COALESCE(l.name, 'General') as land_name,
                lo.timestamp_utc as reported_at
            FROM rides r
            JOIN parks p ON r.park_id = p.id
            LEFT JOIN lands l ON r.land_id = l.id
            JOIN latest_obs lo ON lo.ride_id = r.id AND lo.rn = 1
            WHERE lo.is_open = 0
            ORDER BY p.name ASC, r.name ASC;
        """
        rows = conn.execute(query).fetchall()
        downtimes = []

        now_utc = datetime.now(timezone.utc)

        for r in rows:
            ride_id = r["ride_id"]
            
            # Find when this continuous downtime started
            # Look backwards for the most recent open record
            last_open = conn.execute("""
                SELECT timestamp_utc
                FROM wait_times
                WHERE ride_id = ? AND is_open = 1
                ORDER BY timestamp_utc DESC
                LIMIT 1;
            """, (ride_id,)).fetchone()

            down_since_str = r["reported_at"]
            if last_open:
                # First closed record after the last open record
                first_closed = conn.execute("""
                    SELECT timestamp_utc
                    FROM wait_times
                    WHERE ride_id = ? AND is_open = 0 AND timestamp_utc > ?
                    ORDER BY timestamp_utc ASC
                    LIMIT 1;
                """, (ride_id, last_open["timestamp_utc"])).fetchone()
                if first_closed:
                    down_since_str = first_closed["timestamp_utc"]

            # Estimate duration in minutes
            down_duration_mins = 0
            try:
                # Clean ISO format if .000Z or Z
                clean_ts = down_since_str.replace("Z", "+00:00")
                down_dt = datetime.fromisoformat(clean_ts)
                down_duration_mins = max(1, int((now_utc - down_dt).total_seconds() / 60))
            except Exception:
                down_duration_mins = 5

            downtimes.append({
                "ride_id": r["ride_id"],
                "ride_name": r["ride_name"],
                "park_id": r["park_id"],
                "park_name": r["park_name"],
                "land_name": r["land_name"],
                "down_since": down_since_str,
                "downtime_minutes": down_duration_mins,
            })

        return downtimes
    finally:
        conn.close()

def get_historical_overview() -> Dict[str, Any]:
    """
    Get resort-wide summary of imported historical data:
    total records, actual timer records, date span, and per-attraction breakdown.
    """
    conn = get_connection()
    try:
        total_obs = conn.execute("SELECT COUNT(*) FROM wait_times").fetchone()[0]
        actual_obs = conn.execute("SELECT COUNT(*) FROM wait_times WHERE actual_wait_minutes IS NOT NULL").fetchone()[0]
        calendar_days = conn.execute("SELECT COUNT(*) FROM daily_metadata").fetchone()[0]

        date_range = conn.execute("""
            SELECT MIN(timestamp_utc) as min_date, MAX(timestamp_utc) as max_date
            FROM wait_times
        """).fetchone()

        query = """
            SELECT 
                r.id as ride_id,
                r.name as ride_name,
                p.id as park_id,
                p.name as park_name,
                COALESCE(l.name, 'General') as land_name,
                COUNT(wt.id) as total_obs,
                COUNT(wt.actual_wait_minutes) as actual_obs,
                ROUND(AVG(wt.wait_time_minutes), 1) as avg_posted,
                ROUND(AVG(wt.actual_wait_minutes), 1) as avg_actual
            FROM rides r
            JOIN parks p ON r.park_id = p.id
            LEFT JOIN lands l ON r.land_id = l.id
            JOIN wait_times wt ON wt.ride_id = r.id
            GROUP BY r.id, r.name, p.id, p.name, l.name
            HAVING total_obs >= 25
            ORDER BY total_obs DESC;
        """
        rows = conn.execute(query).fetchall()

        attractions = []
        for r in rows:
            avg_p = r["avg_posted"] or 0
            avg_a = r["avg_actual"] or 0
            inflation = round(((avg_p - avg_a) / avg_a * 100), 1) if avg_a > 0 else 0

            attractions.append({
                "ride_id": r["ride_id"],
                "ride_name": r["ride_name"],
                "park_id": r["park_id"],
                "park_name": r["park_name"],
                "land_name": r["land_name"],
                "total_observations": r["total_obs"],
                "actual_observations": r["actual_obs"],
                "avg_posted_wait": avg_p,
                "avg_actual_wait": avg_a,
                "disney_inflation_percent": inflation,
            })

        return {
            "total_observations": total_obs,
            "actual_timer_observations": actual_obs,
            "calendar_days": calendar_days,
            "earliest_date": date_range["min_date"] if date_range else None,
            "latest_date": date_range["max_date"] if date_range else None,
            "attractions": attractions,
        }
    finally:
        conn.close()

def get_attraction_historical_deepdive(ride_id: int) -> Optional[Dict[str, Any]]:
    """
    Get deep historical analytics for an attraction:
    - Hourly average posted vs actual wait times
    - Sunday vs Saturday vs Weekday averages
    - Peak vs lowest wait hours
    """
    conn = get_connection()
    try:
        ride_row = conn.execute("""
            SELECT r.id, r.name as ride_name, p.id as park_id, p.name as park_name, COALESCE(l.name, 'General') as land_name
            FROM rides r
            JOIN parks p ON r.park_id = p.id
            LEFT JOIN lands l ON r.land_id = l.id
            WHERE r.id = ?;
        """, (ride_id,)).fetchone()

        if not ride_row:
            return None

        # 1. Hourly comparison (posted vs actual)
        # Using Eastern local time (UTC - 4h during EDT, - 5h during EST)
        # We can approximate with datetime(timestamp_utc, '-4 hours')
        query_hourly = """
            SELECT 
                CAST(strftime('%H', datetime(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '-4 hours')) AS INTEGER) as local_hour,
                ROUND(AVG(CASE WHEN is_open = 1 THEN wait_time_minutes ELSE NULL END), 1) as avg_posted,
                ROUND(AVG(actual_wait_minutes), 1) as avg_actual,
                COUNT(*) as sample_count
            FROM wait_times
            WHERE ride_id = ? AND is_open = 1
            GROUP BY local_hour
            ORDER BY local_hour;
        """
        hourly_rows = conn.execute(query_hourly, (ride_id,)).fetchall()
        hourly_map = {r["local_hour"]: r for r in hourly_rows}

        hourly_stats = []
        best_hour = None
        worst_hour = None
        min_wait = 999
        max_wait = -1

        for h in range(8, 23):  # 8 AM to 10 PM
            rec = hourly_map.get(h)
            avg_p = rec["avg_posted"] if rec else None
            avg_a = rec["avg_actual"] if rec else None
            samples = rec["sample_count"] if rec else 0

            period = "AM" if h < 12 else "PM"
            disp_h = h if h <= 12 else h - 12
            if disp_h == 0:
                disp_h = 12
            h_label = f"{disp_h} {period}"

            if avg_p is not None:
                if avg_p < min_wait and samples > 100:
                    min_wait = avg_p
                    best_hour = {"hour": h, "label": h_label, "wait": avg_p}
                if avg_p > max_wait and samples > 100:
                    max_wait = avg_p
                    worst_hour = {"hour": h, "label": h_label, "wait": avg_p}

            hourly_stats.append({
                "hour": h,
                "hour_label": h_label,
                "avg_posted_wait": avg_p,
                "avg_actual_wait": avg_a,
                "sample_count": samples,
            })

        # 2. Day of week averages (0 = Sunday in strftime('%w'))
        query_dow = """
            SELECT 
                CAST(strftime('%w', datetime(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '-4 hours')) AS INTEGER) as day_of_week,
                ROUND(AVG(CASE WHEN is_open = 1 THEN wait_time_minutes ELSE NULL END), 1) as avg_wait,
                COUNT(*) as sample_count
            FROM wait_times
            WHERE ride_id = ? AND is_open = 1
            GROUP BY day_of_week
            ORDER BY day_of_week;
        """
        dow_rows = conn.execute(query_dow, (ride_id,)).fetchall()
        dow_names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
        dow_stats = []
        for r in dow_rows:
            dow_idx = r["day_of_week"]
            dow_stats.append({
                "day_number": dow_idx,
                "day_name": dow_names[dow_idx] if 0 <= dow_idx <= 6 else str(dow_idx),
                "avg_wait": r["avg_wait"],
                "sample_count": r["sample_count"],
            })

        # Overall totals
        overall = conn.execute("""
            SELECT 
                COUNT(*) as total_obs,
                COUNT(actual_wait_minutes) as actual_obs,
                ROUND(AVG(CASE WHEN is_open = 1 THEN wait_time_minutes ELSE NULL END), 1) as avg_posted,
                ROUND(AVG(actual_wait_minutes), 1) as avg_actual
            FROM wait_times
            WHERE ride_id = ?
        """, (ride_id,)).fetchone()

        return {
            "ride_id": ride_row["id"],
            "ride_name": ride_row["ride_name"],
            "park_name": ride_row["park_name"],
            "land_name": ride_row["land_name"],
            "total_observations": overall["total_obs"],
            "actual_observations": overall["actual_obs"],
            "avg_posted_wait": overall["avg_posted"],
            "avg_actual_wait": overall["avg_actual"],
            "best_hour": best_hour,
            "worst_hour": worst_hour,
            "hourly_breakdown": hourly_stats,
            "day_of_week_breakdown": dow_stats,
        }
    finally:
        conn.close()

def get_historical_calendar(limit: int = 100, holiday_only: bool = False) -> List[Dict[str, Any]]:
    """
    Query daily_metadata table for historical crowd calendar, holidays, and weather.
    """
    conn = get_connection()
    try:
        where_clause = "WHERE holiday != ''" if holiday_only else ""
        query = f"""
            SELECT date, season, holiday, day_of_week,
                   mk_open, mk_close, ep_open, ep_close,
                   hs_open, hs_close, ak_open, ak_close,
                   weather_high, weather_low, weather_precip,
                   school_in_session_pct
            FROM daily_metadata
            {where_clause}
            ORDER BY date DESC
            LIMIT ?;
        """
        rows = conn.execute(query, (limit,)).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()

from backend.ride_tiers import (
    RIDE_TIERS,
    get_ride_tier_info,
    PARK_ANCHOR_RIDES,
    PARK_FALLBACK_ANCHORS,
)

def calculate_day_strategy(timeline: List[Dict[str, Any]], stats: Dict[str, Any], tier_info: Dict[str, Any]) -> Dict[str, Any]:
    """Derive actionable time-of-day strategy, real wait expectations, and Lightning Lane advice."""
    peak_wait = stats.get("peak_wait", 0)
    min_wait = stats.get("min_wait", 0)
    peak_time = stats.get("peak_time", "Midday")
    
    # Identify morning lull (before 10:30 AM) and evening lull (after 7:30 PM)
    morning_waits = [p["posted_wait"] for p in timeline if p.get("local_datetime") and " " in p["local_datetime"] and int(p["local_datetime"].split(" ")[1][:2]) < 11 and p.get("is_open")]
    evening_waits = [p["posted_wait"] for p in timeline if p.get("local_datetime") and " " in p["local_datetime"] and int(p["local_datetime"].split(" ")[1][:2]) >= 19 and p.get("is_open")]
    
    avg_lull = round((sum(morning_waits + evening_waits) / len(morning_waits + evening_waits)), 0) if (morning_waits + evening_waits) else min_wait
    time_savings = max(0, peak_wait - int(avg_lull))
    
    expected_actual_peak = round(peak_wait * 0.72)
    
    # Lightning lane advice
    ll_type = tier_info.get("ll_type", "multi_pass")
    if peak_wait >= 70:
        ll_advice = f"Strongly recommended ({tier_info.get('tier_label', 'Tier')}). Queues reach {peak_wait}m peak."
    elif peak_wait >= 40:
        ll_advice = f"Moderate benefit. Recommended if visiting between 11:00 AM and 3:30 PM."
    else:
        ll_advice = f"Low priority for Lightning Lane. Standby line is easily manageable today."
        
    return {
        "best_time_window": "Before 10:15 AM or after 7:45 PM",
        "best_time_expected_wait": f"{int(avg_lull)} min",
        "peak_window": f"{peak_time} peak rush",
        "peak_posted_wait": peak_wait,
        "peak_actual_wait": expected_actual_peak,
        "time_savings_mins": time_savings,
        "real_vs_posted": f"When the board reads {peak_wait}m, in-park timers indicate ~{expected_actual_peak}m actual wait time.",
        "lightning_lane_recommendation": ll_advice,
        "ll_type": ll_type,
    }

def get_ride_day_details(ride_id: int, date_str: str) -> Optional[Dict[str, Any]]:
    """
    Get the full day timeline and metadata for a specific attraction on a chosen calendar day.
    If direct historical records exist, returns ground-truth in-park measurements.
    If direct records do not exist (e.g. non-archived rides like Haunted Mansion, or planning dates),
    uses the A-through-E Ticket Extrapolation Engine anchored to the park's crowd curve.
    """
    conn = get_connection()
    try:
        ride_row = conn.execute("""
            SELECT r.id, r.name as ride_name, p.id as park_id, p.name as park_name, COALESCE(l.name, 'General') as land_name
            FROM rides r
            JOIN parks p ON r.park_id = p.id
            LEFT JOIN lands l ON r.land_id = l.id
            WHERE r.id = ?;
        """, (ride_id,)).fetchone()

        if not ride_row:
            return None

        park_id = ride_row["park_id"]
        tier_info = get_ride_tier_info(ride_id, fallback_park_id=park_id)

        # Dynamic timezone offsets (PDT/PST for California 16 & 17, EDT/EST for Florida 5, 6, 7, 8)
        is_california = park_id in (16, 17)
        summer_offset = "-7 hours" if is_california else "-4 hours"
        winter_offset = "-8 hours" if is_california else "-5 hours"

        # 1. First check if real observations exist for this ride on this date
        query_obs = f"""
            SELECT 
                timestamp_utc,
                datetime(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '{summer_offset}') as local_dt,
                wait_time_minutes,
                is_open,
                actual_wait_minutes
            FROM wait_times
            WHERE ride_id = ? AND date(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '{summer_offset}') = ?
            ORDER BY timestamp_utc ASC;
        """
        rows = conn.execute(query_obs, (ride_id, date_str)).fetchall()

        if not rows:
            query_obs_winter = f"""
                SELECT 
                    timestamp_utc,
                    datetime(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '{winter_offset}') as local_dt,
                    wait_time_minutes,
                    is_open,
                    actual_wait_minutes
                FROM wait_times
                WHERE ride_id = ? AND date(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '{winter_offset}') = ?
                ORDER BY timestamp_utc ASC;
            """
            rows = conn.execute(query_obs_winter, (ride_id, date_str)).fetchall()

        # Fetch daily metadata for this date (holidays, hours, weather, school)
        meta_row = conn.execute("""
            SELECT * FROM daily_metadata WHERE date = ?;
        """, (date_str,)).fetchone()
        meta_dict = dict(meta_row) if meta_row else {}

        # Fetch all-time hourly baseline for this ride
        query_baseline = f"""
            SELECT 
                CAST(strftime('%H', datetime(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '{summer_offset}')) AS INTEGER) as local_hour,
                ROUND(AVG(CASE WHEN is_open = 1 THEN wait_time_minutes ELSE NULL END), 1) as avg_wait
            FROM wait_times
            WHERE ride_id = ? AND is_open = 1
            GROUP BY local_hour;
        """
        baseline_rows = conn.execute(query_baseline, (ride_id,)).fetchall()
        baseline_map = {r["local_hour"]: r["avg_wait"] for r in baseline_rows}

        # SCENARIO A: Real observations exist
        if rows:
            timeline = []
            posted_waits = []
            actual_waits = []
            peak_wait = 0
            peak_time = "N/A"
            min_wait = 999
            min_time = "N/A"

            for r in rows:
                local_dt_str = r["local_dt"]
                time_part = local_dt_str.split(" ")[1][:5] if " " in local_dt_str else ""
                
                display_time = time_part
                try:
                    t_obj = datetime.strptime(time_part, "%H:%M")
                    display_time = t_obj.strftime("%I:%M %p").lstrip("0")
                except Exception:
                    pass

                wait_p = r["wait_time_minutes"]
                is_open = bool(r["is_open"])
                wait_a = r["actual_wait_minutes"]

                if is_open:
                    posted_waits.append(wait_p)
                    if wait_p > peak_wait:
                        peak_wait = wait_p
                        peak_time = display_time
                    if wait_p < min_wait and wait_p > 0:
                        min_wait = wait_p
                        min_time = display_time

                if wait_a is not None:
                    actual_waits.append(wait_a)

                timeline.append({
                    "timestamp_utc": r["timestamp_utc"],
                    "local_time": display_time,
                    "local_datetime": local_dt_str,
                    "posted_wait": wait_p if is_open else 0,
                    "actual_wait": wait_a,
                    "is_open": is_open,
                })

            avg_p = round(sum(posted_waits) / len(posted_waits), 1) if posted_waits else 0
            avg_a = round(sum(actual_waits) / len(actual_waits), 1) if actual_waits else None
            inflation = round(((avg_p - avg_a) / avg_a * 100), 1) if avg_a and avg_a > 0 else None

            stats = {
                "total_observations": len(rows),
                "avg_posted_wait": avg_p,
                "avg_actual_wait": avg_a,
                "disney_inflation_percent": inflation,
                "peak_wait": peak_wait,
                "peak_time": peak_time,
                "min_wait": min_wait if min_wait != 999 else 0,
                "min_time": min_time,
                "actual_timer_count": len(actual_waits),
            }

            strategy = calculate_day_strategy(timeline, stats, tier_info)

            return {
                "ride_id": ride_row["id"],
                "ride_name": ride_row["ride_name"],
                "park_id": park_id,
                "park_name": ride_row["park_name"],
                "land_name": ride_row["land_name"],
                "date": date_str,
                "is_extrapolated": False,
                "data_source": "ground_truth",
                "tier": tier_info["tier"],
                "tier_label": tier_info["tier_label"],
                "tier_ratio": tier_info["ratio"],
                "anchor_ride_id": None,
                "anchor_ride_name": None,
                "metadata": meta_dict,
                "day_stats": stats,
                "strategy": strategy,
                "timeline": timeline,
                "all_time_hourly_baseline": baseline_map,
            }

        # SCENARIO B: No direct observations (Use Ticket-Tier Extrapolation Engine)
        anchor_id = PARK_ANCHOR_RIDES.get(park_id, 129)
        if anchor_id == ride_id:
            anchor_id = PARK_FALLBACK_ANCHORS.get(park_id, 137)

        # Get anchor ride name
        anchor_row = conn.execute("SELECT name FROM rides WHERE id = ?", (anchor_id,)).fetchone()
        anchor_name = anchor_row["name"] if anchor_row else "Flagship E-Ticket"

        # Check if anchor ride has observations on date_str
        anchor_rows = conn.execute(query_obs, (anchor_id, date_str)).fetchall()
        if not anchor_rows:
            anchor_rows = conn.execute(query_obs_winter, (anchor_id, date_str)).fetchall()

        timeline = []
        posted_waits = []
        actual_waits = []
        peak_wait = 0
        peak_time = "N/A"
        min_wait = 999
        min_time = "N/A"

        ratio = tier_info["ratio"]
        typical_min = tier_info["typical_min_wait"]

        if anchor_rows:
            # Scale directly from anchor's real observations on that day
            for ar in anchor_rows:
                local_dt_str = ar["local_dt"]
                time_part = local_dt_str.split(" ")[1][:5] if " " in local_dt_str else ""
                
                display_time = time_part
                try:
                    t_obj = datetime.strptime(time_part, "%H:%M")
                    display_time = t_obj.strftime("%I:%M %p").lstrip("0")
                except Exception:
                    pass

                anchor_wait = ar["wait_time_minutes"]
                is_open = bool(ar["is_open"])

                if is_open and anchor_wait > 0:
                    scaled_wait = max(typical_min, int(round(anchor_wait * ratio)))
                    scaled_actual = int(round(scaled_wait * 0.72))
                    posted_waits.append(scaled_wait)
                    actual_waits.append(scaled_actual)

                    if scaled_wait > peak_wait:
                        peak_wait = scaled_wait
                        peak_time = display_time
                    if scaled_wait < min_wait and scaled_wait > 0:
                        min_wait = scaled_wait
                        min_time = display_time
                else:
                    scaled_wait = 0
                    scaled_actual = None

                timeline.append({
                    "timestamp_utc": ar["timestamp_utc"],
                    "local_time": display_time,
                    "local_datetime": local_dt_str,
                    "posted_wait": scaled_wait if is_open else 0,
                    "actual_wait": scaled_actual,
                    "is_open": is_open,
                })
        else:
            # Anchor also has no direct observations on that day (e.g. recent dates or future dates)
            # Generate synthesized 30-minute interval curve from 8:00 AM to 11:00 PM using hourly baseline
            anchor_baseline_rows = conn.execute(query_baseline, (anchor_id,)).fetchall()
            anchor_baseline_map = {r["local_hour"]: r["avg_wait"] for r in anchor_baseline_rows}

            # If anchor baseline is empty, supply typical theme park bell-curve
            default_curve = {
                8: 25, 9: 45, 10: 75, 11: 95, 12: 105, 13: 110, 14: 105,
                15: 95, 16: 90, 17: 85, 18: 80, 19: 75, 20: 65, 21: 50, 22: 35, 23: 20
            }

            for hour in range(8, 24):
                base_wait = anchor_baseline_map.get(hour, default_curve.get(hour, 60))
                
                # Apply crowd multiplier if daily_metadata exists
                crowd_mult = 1.0
                if meta_dict:
                    park_crowd_key = {6: "mk_crowd", 5: "ep_crowd", 7: "hs_crowd", 8: "ak_crowd", 16: "dl_crowd", 17: "dca_crowd"}.get(park_id, "mk_crowd")
                    crowd_lvl = meta_dict.get(park_crowd_key) or 6
                    crowd_mult = max(0.5, crowd_lvl / 6.0)

                for minute in [0, 30]:
                    time_str = f"{hour:02d}:{minute:02d}"
                    t_obj = datetime.strptime(time_str, "%H:%M")
                    display_time = t_obj.strftime("%I:%M %p").lstrip("0")
                    dt_str = f"{date_str} {time_str}:00"

                    scaled_wait = max(typical_min, int(round(base_wait * crowd_mult * ratio)))
                    scaled_actual = int(round(scaled_wait * 0.72))

                    posted_waits.append(scaled_wait)
                    actual_waits.append(scaled_actual)

                    if scaled_wait > peak_wait:
                        peak_wait = scaled_wait
                        peak_time = display_time
                    if scaled_wait < min_wait:
                        min_wait = scaled_wait
                        min_time = display_time

                    timeline.append({
                        "timestamp_utc": f"{date_str}T{time_str}:00Z",
                        "local_time": display_time,
                        "local_datetime": dt_str,
                        "posted_wait": scaled_wait,
                        "actual_wait": scaled_actual,
                        "is_open": True,
                    })

        avg_p = round(sum(posted_waits) / len(posted_waits), 1) if posted_waits else 0
        avg_a = round(sum(actual_waits) / len(actual_waits), 1) if actual_waits else None
        inflation = round(((avg_p - avg_a) / avg_a * 100), 1) if avg_a and avg_a > 0 else 28.0

        stats = {
            "total_observations": len(timeline),
            "avg_posted_wait": avg_p,
            "avg_actual_wait": avg_a,
            "disney_inflation_percent": inflation,
            "peak_wait": peak_wait,
            "peak_time": peak_time,
            "min_wait": min_wait if min_wait != 999 else 0,
            "min_time": min_time,
            "actual_timer_count": len(actual_waits),
        }

        # Build baseline map for this extrapolated ride if empty
        if not baseline_map:
            baseline_map = {h: max(typical_min, round(default_curve.get(h, 50) * ratio, 1)) for h in range(8, 24)}

        strategy = calculate_day_strategy(timeline, stats, tier_info)

        return {
            "ride_id": ride_row["id"],
            "ride_name": ride_row["ride_name"],
            "park_id": park_id,
            "park_name": ride_row["park_name"],
            "land_name": ride_row["land_name"],
            "date": date_str,
            "is_extrapolated": True,
            "data_source": "tier_extrapolated",
            "tier": tier_info["tier"],
            "tier_label": tier_info["tier_label"],
            "tier_ratio": tier_info["ratio"],
            "anchor_ride_id": anchor_id,
            "anchor_ride_name": anchor_name,
            "metadata": meta_dict,
            "day_stats": stats,
            "strategy": strategy,
            "timeline": timeline,
            "all_time_hourly_baseline": baseline_map,
        }
    finally:
        conn.close()

def evaluate_wishlist(park_id: int, date_str: str, ride_ids: List[int], family_size: int = 5) -> Dict[str, Any]:
    """
    Evaluate a family's selected attraction wishlist for a specific date:
    - Sums cumulative standby queue time in minutes and hours
    - Computes hours saved with Lightning Lane
    - Evaluates total family financial cost vs hours reclaimed
    - Delivers an objective Lightning Lane stewardship verdict (Recommended, Optional Split, Skip)
    """
    conn = get_connection()
    try:
        rides_breakdown = []
        total_standby_minutes = 0

        for r_id in ride_ids:
            day_data = get_ride_day_details(r_id, date_str)
            if not day_data:
                continue

            tier_info = get_ride_tier_info(r_id, fallback_park_id=park_id)
            stats = day_data.get("day_stats", {})
            peak_wait = stats.get("peak_wait", 45)
            avg_wait = stats.get("avg_posted_wait", 35)

            # Use realistic midday queue estimate
            midday_estimate = int(round((peak_wait + avg_wait) / 2))
            total_standby_minutes += midday_estimate

            rides_breakdown.append({
                "ride_id": r_id,
                "ride_name": day_data["ride_name"],
                "tier": tier_info["tier"],
                "tier_label": tier_info["tier_label"],
                "midday_wait_mins": midday_estimate,
                "peak_wait_mins": peak_wait,
                "ll_type": tier_info.get("ll_type", "multi_pass"),
                "is_extrapolated": day_data.get("is_extrapolated", False),
            })

        # Calculate time metrics
        total_hours = round(total_standby_minutes / 60, 1)
        # Average Lightning Lane queue takes ~12 minutes
        ll_total_minutes = len(rides_breakdown) * 12
        minutes_saved = max(0, total_standby_minutes - ll_total_minutes)
        hours_saved = round(minutes_saved / 60, 1)

        # Financial cost analysis ($27/person Multi Pass average)
        price_per_pass = 27
        total_family_cost = price_per_pass * family_size
        cost_per_hour_saved = round(total_family_cost / max(hours_saved, 0.5), 2)

        # Check park crowd level if metadata exists
        meta_row = conn.execute("SELECT * FROM daily_metadata WHERE date = ?", (date_str,)).fetchone()
        meta_dict = dict(meta_row) if meta_row else {}
        park_crowd_key = {6: "mk_crowd", 5: "ep_crowd", 7: "hs_crowd", 8: "ak_crowd"}.get(park_id, "mk_crowd")
        crowd_lvl = meta_dict.get(park_crowd_key) or 6

        # Generate verdict
        if hours_saved >= 3.0 or crowd_lvl >= 8:
            verdict_status = "recommended"
            verdict_title = "🚨 Lightning Lane Strongly Recommended"
            verdict_badge = "High Crowd Day — Reclaim Your Family's Time"
            verdict_summary = (
                f"Your {len(rides_breakdown)} must-do rides will consume roughly {total_hours} hours "
                f"standing in line on this date. With Lightning Lane, your family will reclaim ~{hours_saved} hours "
                f"of park time, avoiding exhausted children and long midday waits."
            )
        elif total_standby_minutes <= 85 or crowd_lvl <= 4:
            verdict_status = "skip"
            verdict_title = "💡 Save Your Money — Skip Lightning Lane"
            verdict_badge = "Low/Moderate Crowd — Sound Financial Stewardship"
            verdict_summary = (
                f"Your selected attractions only total {total_standby_minutes} minutes combined across the day. "
                f"By rope-dropping your top choice and riding during evening fireworks, you can easily hit all {len(rides_breakdown)} "
                f"without paying Disney an extra ${total_family_cost}!"
            )
        else:
            verdict_status = "optional_split"
            verdict_title = "⚖️ Strategic Split Recommendation"
            verdict_badge = "Moderate Crowd — Target Single Pass Only"
            verdict_summary = (
                f"Consider buying an a la carte Single Pass ($13–$16) for headliners, but skip the full Multi Pass bundle (${total_family_cost}). "
                f"Your D and C-ticket classics can be ridden with under 25-minute waits before 10:30 AM or after 6:00 PM."
            )

        return {
            "park_id": park_id,
            "date": date_str,
            "family_size": family_size,
            "crowd_level": crowd_lvl,
            "total_rides_count": len(rides_breakdown),
            "total_standby_minutes": total_standby_minutes,
            "total_standby_hours": total_hours,
            "hours_saved_with_ll": hours_saved,
            "estimated_family_cost": total_family_cost,
            "cost_per_hour_saved": cost_per_hour_saved,
            "verdict": {
                "status": verdict_status,
                "title": verdict_title,
                "badge": verdict_badge,
                "summary": verdict_summary,
            },
            "rides": rides_breakdown,
        }
    finally:
        conn.close()

def get_ride_available_dates(ride_id: int) -> Dict[str, Any]:
    """
    Get date boundaries, total days with data, and popular holiday/event presets for this ride.
    """
    conn = get_connection()
    try:
        range_row = conn.execute("""
            SELECT 
                MIN(date(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '-4 hours')) as min_date,
                MAX(date(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '-4 hours')) as max_date,
                COUNT(DISTINCT date(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '-4 hours')) as total_days
            FROM wait_times
            WHERE ride_id = ?;
        """, (ride_id,)).fetchone()

        presets = [
            {"label": "🎄 Christmas Day 2021", "date": "2021-12-25", "tag": "Peak Holiday"},
            {"label": "✝️ Easter Sunday 2019", "date": "2019-04-21", "tag": "Holy Day Peak"},
            {"label": "✝️ Easter Sunday 2021", "date": "2021-04-04", "tag": "Holy Day Peak"},
            {"label": "🎆 New Year's Eve 2019", "date": "2019-12-31", "tag": "Highest Crowd Peak"},
            {"label": "🇺🇸 4th of July 2019", "date": "2019-07-04", "tag": "Summer Holiday"},
            {"label": "🦃 Thanksgiving 2019", "date": "2019-11-28", "tag": "Holiday Week"},
            {"label": "☀️ Peak Summer Sunday", "date": "2019-07-21", "tag": "Summer Sunday"},
            {"label": "🍂 Quiet Fall Tuesday", "date": "2019-09-17", "tag": "Ordinary Time Lull"},
        ]

        return {
            "ride_id": ride_id,
            "min_date": range_row["min_date"] if range_row else "2015-01-01",
            "max_date": range_row["max_date"] if range_row else "2026-09-02",
            "total_days_available": range_row["total_days"] if range_row else 0,
            "presets": presets,
        }
    finally:
        conn.close()

def get_ride_history(ride_id: int) -> Optional[Dict[str, Any]]:
    """
    Get time-series data for a ride:
    1. Today's live wait curve (polled data for current day).
    2. Historical hourly rolling average (average wait time per hour across all past days).
    """
    conn = get_connection()
    try:
        ride_row = conn.execute("""
            SELECT r.id, r.name as ride_name, p.id as park_id, p.name as park_name, COALESCE(l.name, 'General') as land_name
            FROM rides r
            JOIN parks p ON r.park_id = p.id
            LEFT JOIN lands l ON r.land_id = l.id
            WHERE r.id = ?;
        """, (ride_id,)).fetchone()

        if not ride_row:
            return None

        park_id = ride_row["park_id"]
        local_offset = get_park_utc_offset(park_id)

        # Today's date in park's local time (Eastern or Pacific)
        now_local = datetime.now(timezone.utc) + timedelta(hours=local_offset)
        today_date_str = now_local.strftime("%Y-%m-%d")

        # Today's live observations
        today_rows = conn.execute("""
            SELECT timestamp_utc, wait_time_minutes, is_open
            FROM wait_times
            WHERE ride_id = ? AND timestamp_utc LIKE ?
            ORDER BY timestamp_utc ASC;
        """, (ride_id, f"{today_date_str}%")).fetchall()

        today_points = []
        for rec in today_rows:
            ts_str = rec["timestamp_utc"]
            try:
                clean_ts = ts_str.replace("Z", "+00:00")
                utc_dt = datetime.fromisoformat(clean_ts)
                local_dt = utc_dt + timedelta(hours=local_offset)
            except Exception:
                continue

            today_points.append({
                "timestamp_utc": ts_str,
                "time_label": local_dt.strftime("%I:%M %p"),
                "local_hour": local_dt.hour,
                "local_minute": local_dt.minute,
                "wait_time": rec["wait_time_minutes"] if rec["is_open"] else None,
                "is_open": bool(rec["is_open"]),
            })

        # Fast SQL aggregation for historical hourly averages with park local timezone
        query_hist = f"""
            SELECT 
                CAST(strftime('%H', datetime(replace(replace(timestamp_utc, 'Z', ''), 'T', ' '), '{local_offset} hours')) AS INTEGER) as local_hour,
                ROUND(AVG(CASE WHEN is_open = 1 THEN wait_time_minutes ELSE NULL END), 1) as avg_wait,
                COUNT(*) as sample_count
            FROM wait_times
            WHERE ride_id = ? AND is_open = 1
            GROUP BY local_hour;
        """
        hist_rows = conn.execute(query_hist, (ride_id,)).fetchall()
        hist_map = {r["local_hour"]: r for r in hist_rows}

        # Check total sample count in historical dataset
        hist_sample_count = sum(r["sample_count"] for r in hist_rows) if hist_rows else 0

        # If this ride has few/no historical observations (e.g. non-anchor attractions),
        # extrapolate historical hourly averages using the park anchor and ticket-tier ratio
        is_extrapolated_history = False
        if hist_sample_count < 20:
            is_extrapolated_history = True
            tier_info = get_ride_tier_info(ride_id, fallback_park_id=park_id)
            anchor_id = PARK_ANCHOR_RIDES.get(park_id, 129)
            if anchor_id == ride_id:
                anchor_id = PARK_FALLBACK_ANCHORS.get(park_id, 137)

            anchor_hist_rows = conn.execute(query_hist, (anchor_id,)).fetchall()
            ratio = tier_info.get("ratio", 0.6)
            typical_min = tier_info.get("typical_min_wait", 15)

            if anchor_hist_rows:
                hist_map = {}
                for ar in anchor_hist_rows:
                    lh = ar["local_hour"]
                    anchor_avg = ar["avg_wait"] or 40
                    scaled_avg = max(typical_min, round(anchor_avg * ratio, 1))
                    hist_map[lh] = {
                        "local_hour": lh,
                        "avg_wait": scaled_avg,
                        "sample_count": ar["sample_count"],
                    }
                hist_sample_count = sum(ar["sample_count"] for ar in anchor_hist_rows)
            else:
                default_bell = {
                    8: 25, 9: 45, 10: 65, 11: 80, 12: 85, 13: 88, 14: 85,
                    15: 80, 16: 78, 17: 72, 18: 70, 19: 65, 20: 55, 21: 45, 22: 35, 23: 20
                }
                hist_map = {
                    h: {
                        "local_hour": h,
                        "avg_wait": max(typical_min, round(default_bell.get(h, 50) * ratio, 1)),
                        "sample_count": 120,
                    }
                    for h in range(8, 24)
                }
                hist_sample_count = 1920

        hourly_averages = []
        for hour in range(7, 24):
            rec = hist_map.get(hour)
            avg_val = rec["avg_wait"] if rec else None
            samples = rec["sample_count"] if rec else 0

            period = "AM" if hour < 12 else "PM"
            display_h = hour if hour <= 12 else hour - 12
            if display_h == 0:
                display_h = 12
            hour_label = f"{display_h} {period}"

            hourly_averages.append({
                "hour": hour,
                "hour_label": hour_label,
                "avg_wait_time": avg_val,
                "sample_count": samples,
            })

        latest_obs = conn.execute("""
            SELECT wait_time_minutes, is_open, timestamp_utc
            FROM wait_times
            WHERE ride_id = ?
            ORDER BY timestamp_utc DESC
            LIMIT 1;
        """, (ride_id,)).fetchone()

        current_wait = latest_obs["wait_time_minutes"] if latest_obs else 0
        current_open = bool(latest_obs["is_open"]) if latest_obs else False

        return {
            "ride_id": ride_row["id"],
            "ride_name": ride_row["ride_name"],
            "park_id": ride_row["park_id"],
            "park_name": ride_row["park_name"],
            "land_name": ride_row["land_name"],
            "current_wait": current_wait,
            "is_open": current_open,
            "total_historical_samples": hist_sample_count,
            "is_extrapolated_history": is_extrapolated_history,
            "today_curve": today_points,
            "hourly_averages": hourly_averages,
        }
    finally:
        conn.close()

def seed_demo_history_if_needed(days: int = 7) -> int:
    """
    Seed realistic historical observations for past days if the database
    has fewer than 500 total wait time records. This ensures immediate rich
    time-series comparisons and historical hourly curves upon fresh installation.
    """
    conn = get_connection()
    try:
        count = conn.execute("SELECT COUNT(*) FROM wait_times").fetchone()[0]
        if count >= 500:
            return 0  # Already has sufficient data
    finally:
        conn.close()

    # Generate historical data based on current rides and baseline wait times
    rides = get_all_rides()
    if not rides:
        return 0

    now_utc = datetime.now(timezone.utc)
    inserted_rows = 0

    with get_db() as db:
        cursor = db.cursor()
        for r in rides:
            ride_id = r["id"]
            base_wait = max(10, r["wait_time"] or 25)

            # Generate hourly readings for each of past N days
            for d in range(1, days + 1):
                day_offset = timedelta(days=d)
                # Park open hours in local time: 8 AM to 10 PM
                for hour in range(8, 22):
                    # Typical theme park curve multiplier (rises at midday, drops at night)
                    if hour in (8, 9):
                        factor = 0.5
                    elif hour in (11, 12, 13, 14, 15):
                        factor = 1.3
                    elif hour in (16, 17, 18, 19):
                        factor = 1.1
                    else:
                        factor = 0.7

                    # Slight randomness per day
                    jitter = random.uniform(0.8, 1.2)
                    sim_wait = max(5, int(round((base_wait * factor * jitter) / 5.0) * 5))
                    sim_open = 1 if random.random() > 0.05 else 0
                    if not sim_open:
                        sim_wait = 0

                    # Convert local hour to UTC (Local = UTC - 4, so UTC = Local + 4)
                    sim_utc = (now_utc - day_offset).replace(
                        hour=(hour + 4) % 24, minute=random.choice([0, 15, 30, 45]), second=0, microsecond=0
                    )
                    ts_str = sim_utc.strftime("%Y-%m-%dT%H:%M:%SZ")

                    cursor.execute("""
                        INSERT OR IGNORE INTO wait_times (ride_id, timestamp_utc, wait_time_minutes, is_open)
                        VALUES (?, ?, ?, ?);
                    """, (ride_id, ts_str, sim_wait, sim_open))
                    inserted_rows += 1

    return inserted_rows

def get_park_least_busy_days(park_id: int) -> Optional[Dict[str, Any]]:
    """
    Evaluate all recorded calendar dates for a specific park and rank the least busy days of the year.
    Returns:
    - Top 10 lowest crowd dates with average wait, weather, and day of week
    - Top 5 peak/busiest dates for comparison
    - Day of week ranking (e.g. Tuesday vs Saturday)
    - 4 Seasonal Sweet Spots travel recommendation windows
    - Headliner attraction wait comparison (Lowest Day vs Peak Day)
    """
    conn = get_connection()
    try:
        park_row = conn.execute(
            "SELECT id, name, COALESCE(resort, 'Walt Disney World') as resort FROM parks WHERE id = ?",
            (park_id,)
        ).fetchone()
        if not park_row:
            return None

        local_offset = get_park_utc_offset(park_id)
        offset_str = f"{local_offset} hours"

        # Query average wait time per date for this park
        query = f"""
            SELECT 
                strftime('%Y-%m-%d', datetime(replace(replace(wt.timestamp_utc, 'Z', ''), 'T', ' '), '{offset_str}')) as local_date,
                ROUND(AVG(CASE WHEN wt.is_open = 1 THEN wt.wait_time_minutes ELSE NULL END), 1) as avg_wait,
                MAX(CASE WHEN wt.is_open = 1 THEN wt.wait_time_minutes ELSE 0 END) as peak_wait,
                MIN(CASE WHEN wt.is_open = 1 THEN wt.wait_time_minutes ELSE NULL END) as min_wait,
                COUNT(wt.id) as sample_count,
                dm.holiday,
                dm.season,
                dm.weather_high,
                dm.weather_low,
                dm.school_in_session_pct
            FROM wait_times wt
            JOIN rides r ON wt.ride_id = r.id
            LEFT JOIN daily_metadata dm ON dm.date = strftime('%Y-%m-%d', datetime(replace(replace(wt.timestamp_utc, 'Z', ''), 'T', ' '), '{offset_str}'))
            WHERE r.park_id = ? AND wt.is_open = 1
            GROUP BY local_date
            HAVING sample_count >= 10 AND avg_wait > 0
            ORDER BY avg_wait ASC;
        """
        rows = conn.execute(query, (park_id,)).fetchall()

        all_dates = []
        dow_buckets = {i: [] for i in range(7)}
        DOW_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]

        for r in rows:
            d_str = r["local_date"]
            try:
                dt_obj = datetime.strptime(d_str, "%Y-%m-%d")
                dow_idx = dt_obj.weekday()
                dow_name = DOW_NAMES[dow_idx]
                formatted_d = dt_obj.strftime("%A, %b %d, %Y")
                short_d = dt_obj.strftime("%b %d")
            except Exception:
                dow_idx = 0
                dow_name = "Day"
                formatted_d = d_str
                short_d = d_str

            avg_w = r["avg_wait"] or 0
            dow_buckets[dow_idx].append(avg_w)

            crowd = calculate_crowd_level(avg_w, park_id)

            holiday_ctx = r["holiday"]
            if not holiday_ctx or holiday_ctx == "0":
                holiday_ctx = "Regular Operating Day"

            all_dates.append({
                "date": d_str,
                "formatted_date": formatted_d,
                "short_date": short_d,
                "day_of_week": dow_name,
                "avg_wait": avg_w,
                "peak_wait": r["peak_wait"] or 0,
                "min_wait": r["min_wait"] or 0,
                "crowd_level": crowd,
                "holiday": holiday_ctx,
                "season": r["season"] or "REGULAR",
                "weather_high": r["weather_high"] or 78.0,
                "weather_low": r["weather_low"] or 60.0,
                "school_in_session_pct": r["school_in_session_pct"] if r["school_in_session_pct"] is not None else 85.0,
            })

        # If sparse rows for a newer park, ensure default curated dates exist
        if len(all_dates) < 5:
            cal_rows = conn.execute("""
                SELECT date, holiday, season, weather_high, weather_low, school_in_session_pct
                FROM daily_metadata
                WHERE date >= '2021-04-30'
                ORDER BY school_in_session_pct DESC, date ASC
                LIMIT 30;
            """).fetchall()

            for cr in cal_rows:
                d_str = cr["date"]
                if any(x["date"] == d_str for x in all_dates):
                    continue
                try:
                    dt_obj = datetime.strptime(d_str, "%Y-%m-%d")
                    dow_idx = dt_obj.weekday()
                    dow_name = DOW_NAMES[dow_idx]
                    formatted_d = dt_obj.strftime("%A, %b %d, %Y")
                    short_d = dt_obj.strftime("%b %d")
                except Exception:
                    dow_idx = 0
                    dow_name = "Day"
                    formatted_d = d_str
                    short_d = d_str

                # Estimate based on school session percentage
                school_pct = cr["school_in_session_pct"] or 85.0
                sim_avg = round(21.0 + (100.0 - school_pct) * 0.45, 1)
                dow_buckets[dow_idx].append(sim_avg)

                all_dates.append({
                    "date": d_str,
                    "formatted_date": formatted_d,
                    "short_date": short_d,
                    "day_of_week": dow_name,
                    "avg_wait": sim_avg,
                    "peak_wait": round(sim_avg * 1.6),
                    "min_wait": 10,
                    "crowd_level": calculate_crowd_level(sim_avg, park_id),
                    "holiday": cr["holiday"] or "Regular Day",
                    "season": cr["season"] or "REGULAR",
                    "weather_high": cr["weather_high"] or 78.0,
                    "weather_low": cr["weather_low"] or 60.0,
                    "school_in_session_pct": school_pct,
                })
            all_dates.sort(key=lambda x: x["avg_wait"])

        top_least_busy = all_dates[:10]
        all_dates_by_high = sorted(all_dates, key=lambda x: x["avg_wait"], reverse=True)
        top_busiest = all_dates_by_high[:5]

        dow_rankings = []
        for i, name in enumerate(DOW_NAMES):
            waits = dow_buckets[i]
            avg_dow = round(sum(waits) / len(waits), 1) if waits else 36.0
            dow_rankings.append({
                "day_index": i,
                "day_name": name,
                "avg_wait": avg_dow,
                "samples": len(waits),
                "crowd_level": calculate_crowd_level(avg_dow, park_id),
            })
        dow_rankings.sort(key=lambda x: x["avg_wait"])

        is_california = park_id in (16, 17)
        if is_california:
            sweet_spots = [
                {
                    "title": "Post-Labor Day Fall Lull (Mid-September)",
                    "window": "Sep 8 – Sep 28 (Tuesdays–Thursdays)",
                    "avg_wait_range": "18 – 26 min",
                    "crowd_badge": "🟢 Empty / Walk-on",
                    "crowd_color": "#10b981",
                    "highlight": "Best time of the entire year. California schools are in session and holiday rushes have not yet begun.",
                },
                {
                    "title": "Winter Lull (Late January to Early February)",
                    "window": "Jan 18 – Feb 10 (Weekdays)",
                    "avg_wait_range": "22 – 28 min",
                    "crowd_badge": "🔵 Light Crowds",
                    "crowd_color": "#06b6d4",
                    "highlight": "Post-holiday downtime with crisp California weather and fast walk-on queues for Radiator Springs & Space Mountain.",
                },
                {
                    "title": "Spring Pre-Summer Window (Early May)",
                    "window": "May 1 – May 18 (Tuesdays–Thursdays)",
                    "avg_wait_range": "25 – 32 min",
                    "crowd_badge": "🔵 Light Crowds",
                    "crowd_color": "#06b6d4",
                    "highlight": "Spring breaks have concluded and summer vacationers have not yet arrived.",
                },
                {
                    "title": "Pre-Thanksgiving Autumn Gap (Early November)",
                    "window": "Nov 1 – Nov 14 (Weekdays)",
                    "avg_wait_range": "26 – 33 min",
                    "crowd_badge": "🔵 Light Crowds",
                    "crowd_color": "#06b6d4",
                    "highlight": "Holiday overlays and seasonal decorations are live before the Thanksgiving travel rush arrives.",
                },
            ]
        else:
            sweet_spots = [
                {
                    "title": "Post-Labor Day September Sweet Spot",
                    "window": "Sep 8 – Sep 30 (Tuesdays–Thursdays)",
                    "avg_wait_range": "20 – 28 min",
                    "crowd_badge": "🟢 Empty / Walk-on",
                    "crowd_color": "#10b981",
                    "highlight": "The lowest wait times of the year across all 4 Disney World parks as nationwide school sessions resume.",
                },
                {
                    "title": "Late January Post-Marathon Lull",
                    "window": "Jan 16 – Feb 8 (Weekdays)",
                    "avg_wait_range": "24 – 32 min",
                    "crowd_badge": "🔵 Light Crowds",
                    "crowd_color": "#06b6d4",
                    "highlight": "Pleasant Florida winter temperatures and low crowds before Presidents' Day weekend.",
                },
                {
                    "title": "First Half of May Window",
                    "window": "Apr 28 – May 15 (Tuesdays–Thursdays)",
                    "avg_wait_range": "28 – 35 min",
                    "crowd_badge": "🔵 Light Crowds",
                    "crowd_color": "#06b6d4",
                    "highlight": "Lull between Spring Break / Easter travel and Memorial Day summer rush with EPCOT Flower & Garden in full bloom.",
                },
                {
                    "title": "Pre-Thanksgiving November Gap",
                    "window": "Nov 2 – Nov 16 (Weekdays)",
                    "avg_wait_range": "27 – 34 min",
                    "crowd_badge": "🔵 Light Crowds",
                    "crowd_color": "#06b6d4",
                    "highlight": "Christmas decorations and holiday castle lights are up with a fraction of the December crowd volume.",
                },
            ]

        # Top 4 headline attractions comparison (Least Busy Day vs Peak Day)
        top_rides_rows = conn.execute("""
            SELECT id, name FROM rides WHERE park_id = ? ORDER BY id LIMIT 4
        """, (park_id,)).fetchall()

        attraction_comparisons = []
        for tr in top_rides_rows:
            tier_info = get_ride_tier_info(tr["id"], fallback_park_id=park_id)
            ratio = tier_info.get("ratio", 0.7)
            min_day_wait = max(10, round(24 * ratio))
            peak_day_wait = max(25, round(88 * ratio))
            saved = peak_day_wait - min_day_wait

            attraction_comparisons.append({
                "ride_id": tr["id"],
                "ride_name": tr["name"],
                "least_busy_wait": min_day_wait,
                "peak_day_wait": peak_day_wait,
                "minutes_saved_standby": saved,
            })

        return {
            "park_id": park_id,
            "park_name": park_row["name"],
            "resort": park_row["resort"],
            "total_dates_analyzed": len(all_dates),
            "top_least_busy_days": top_least_busy,
            "top_busiest_days": top_busiest,
            "best_day_of_week": dow_rankings[0]["day_name"] if dow_rankings else "Tuesday",
            "busiest_day_of_week": dow_rankings[-1]["day_name"] if dow_rankings else "Saturday",
            "day_of_week_rankings": dow_rankings,
            "seasonal_sweet_spots": sweet_spots,
            "attraction_comparisons": attraction_comparisons,
        }
    finally:
        conn.close()
