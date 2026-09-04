"""
Static data exporter: Extract 5-year historical intelligence from SQLite into
lightweight JSON files for static Netlify hosting and serverless functions.
"""

import os
import json
import sqlite3
from backend.database import DB_PATH, get_connection
from backend.services import (
    get_historical_overview,
    get_park_least_busy_days,
    get_historical_calendar,
    get_all_rides,
    get_ride_history,
    get_attraction_historical_deepdive,
)
from backend.ride_tiers import RIDE_TIERS

def export_all():
    output_dir = os.path.join(os.path.dirname(__file__), "frontend", "data")
    os.makedirs(output_dir, exist_ok=True)
    print(f"Exporting static data to {output_dir}...")

    # 1. Historical Overview
    overview = get_historical_overview()
    with open(os.path.join(output_dir, "history_overview.json"), "w", encoding="utf-8") as f:
        json.dump(overview, f, indent=2)
    print("Exported history_overview.json")

    # 2. Least Busy Days for each park (5, 6, 7, 8, 16, 17)
    least_busy = {}
    for park_id in [5, 6, 7, 8, 16, 17]:
        data = get_park_least_busy_days(park_id)
        least_busy[str(park_id)] = data
        with open(os.path.join(output_dir, f"least_busy_{park_id}.json"), "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    with open(os.path.join(output_dir, "least_busy_all.json"), "w", encoding="utf-8") as f:
        json.dump(least_busy, f, indent=2)
    print("Exported least_busy data")

    # 3. Calendar & Milestones
    cal = get_historical_calendar()
    with open(os.path.join(output_dir, "calendar.json"), "w", encoding="utf-8") as f:
        json.dump(cal, f, indent=2)
    print("Exported calendar.json")

    # 4. Ride Tiers & Metadata
    with open(os.path.join(output_dir, "ride_tiers.json"), "w", encoding="utf-8") as f:
        json.dump(RIDE_TIERS, f, indent=2)
    print("Exported ride_tiers.json")

    # 5. Historical Hourly Curves for all rides
    conn = get_connection()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.id, r.name, r.park_id, p.name as park_name, COALESCE(l.name, 'General') as land_name
        FROM rides r
        JOIN parks p ON r.park_id = p.id
        LEFT JOIN lands l ON r.land_id = l.id
        ORDER BY r.park_id, r.name
    """)
    rides = cursor.fetchall()
    
    ride_curves = {}
    ride_deepdives = {}
    for ride in rides:
        ride_id = ride["id"]
        try:
            hist = get_ride_history(ride_id)
            if hist:
                ride_curves[str(ride_id)] = hist
        except Exception:
            pass

        try:
            deep = get_attraction_historical_deepdive(ride_id)
            if deep:
                ride_deepdives[str(ride_id)] = deep
        except Exception:
            pass

    with open(os.path.join(output_dir, "ride_curves.json"), "w", encoding="utf-8") as f:
        json.dump(ride_curves, f)
    with open(os.path.join(output_dir, "ride_deepdives.json"), "w", encoding="utf-8") as f:
        json.dump(ride_deepdives, f)
    print(f"Exported curves for {len(ride_curves)} rides, deepdives for {len(ride_deepdives)} rides")

    # 6. Parks & Baseline Rides Catalog
    cursor.execute("SELECT * FROM parks ORDER BY id")
    parks = [dict(p) for p in cursor.fetchall()]
    with open(os.path.join(output_dir, "parks.json"), "w", encoding="utf-8") as f:
        json.dump(parks, f, indent=2)

    cursor.execute("""
        SELECT r.id, r.name, r.park_id, COALESCE(l.name, 'General') as land_name, p.name as park_name, p.resort
        FROM rides r
        JOIN parks p ON r.park_id = p.id
        LEFT JOIN lands l ON r.land_id = l.id
        ORDER BY r.park_id, r.name
    """)
    catalog = [dict(r) for r in cursor.fetchall()]
    with open(os.path.join(output_dir, "rides_catalog.json"), "w", encoding="utf-8") as f:
        json.dump(catalog, f, indent=2)
    print(f"Exported {len(parks)} parks and {len(catalog)} rides to catalog JSON")

    conn.close()
    print("Static export complete!")

if __name__ == "__main__":
    export_all()
