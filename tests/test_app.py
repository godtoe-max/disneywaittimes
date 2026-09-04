"""
Comprehensive Test Suite for Disney World Wait Time Tracker.
Tests SQLite schema, ingestion worker, API endpoints, time-series curves, and static files.
"""

import os
import unittest
from fastapi.testclient import TestClient

from backend.database import init_db, get_connection
from backend.services import (
    get_parks_summary,
    get_park_live_waits,
    get_all_rides,
    get_ride_history,
    get_current_downtimes,
    seed_demo_history_if_needed,
)
from backend.main import app

class TestDisneyWaitTimesTracker(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Ensure database is initialized
        init_db()
        seed_demo_history_if_needed(days=3)
        cls.client = TestClient(app)

    def test_01_database_schema(self):
        """Verify all required tables and indexes exist."""
        conn = get_connection()
        try:
            tables = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
            self.assertIn("parks", tables)
            self.assertIn("lands", tables)
            self.assertIn("rides", tables)
            self.assertIn("wait_times", tables)

            indexes = [r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='index'").fetchall()]
            self.assertIn("idx_wait_times_ride_timestamp", indexes)
            self.assertIn("idx_wait_times_timestamp", indexes)
            self.assertIn("idx_rides_park", indexes)

            # Check 6 Disney parks seeded (4 WDW + 2 Disneyland Resort)
            parks = conn.execute("SELECT id, name FROM parks ORDER BY id").fetchall()
            park_ids = [p["id"] for p in parks]
            self.assertEqual(sorted(park_ids), [5, 6, 7, 8, 16, 17])
        finally:
            conn.close()

    def test_02_health_endpoint(self):
        """Test /api/health endpoint."""
        res = self.client.get("/api/health")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json().get("status"), "ok")

    def test_03_parks_summary_endpoint(self):
        """Test /api/parks endpoint returns 6 parks with valid aggregations."""
        res = self.client.get("/api/parks")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(len(data), 6)

        park_names = [p["name"] for p in data]
        self.assertIn("Magic Kingdom", park_names)
        self.assertIn("EPCOT", park_names)
        self.assertIn("Disneyland Park", park_names)
        self.assertIn("Disney California Adventure", park_names)

        # Verify attributes on each park card
        for park in data:
            self.assertIn("id", park)
            self.assertIn("name", park)
            self.assertIn("total_rides", park)
            self.assertIn("open_rides", park)
            self.assertIn("down_rides", park)
            self.assertIn("avg_wait_time", park)
            self.assertIn("max_wait_time", park)
            self.assertIn("top_ride_name", park)
            self.assertGreaterEqual(park["total_rides"], 15)

    def test_04_park_live_endpoint(self):
        """Test /api/parks/6/live (Magic Kingdom) returns grouped lands and rides."""
        res = self.client.get("/api/parks/6/live")
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertEqual(data["park_id"], 6)
        self.assertEqual(data["park_name"], "Magic Kingdom")
        self.assertIn("lands", data)
        self.assertGreater(len(data["lands"]), 0)

        # Verify ride attributes
        sample_land = data["lands"][0]
        self.assertIn("name", sample_land)
        self.assertIn("rides", sample_land)
        if sample_land["rides"]:
            ride = sample_land["rides"][0]
            self.assertIn("id", ride)
            self.assertIn("name", ride)
            self.assertIn("wait_time", ride)
            self.assertIn("is_open", ride)

    def test_05_search_rides_endpoint(self):
        """Test /api/rides with search query and open filter."""
        # Unfiltered
        res_all = self.client.get("/api/rides")
        self.assertEqual(res_all.status_code, 200)
        all_rides = res_all.json()
        self.assertGreater(len(all_rides), 50)

        # Filter by park (EPCOT: 5)
        res_epcot = self.client.get("/api/rides?park_id=5")
        self.assertEqual(res_epcot.status_code, 200)
        epcot_rides = res_epcot.json()
        for r in epcot_rides:
            self.assertEqual(r["park_id"], 5)

        # Search by keyword
        res_search = self.client.get("/api/rides?search=Space")
        self.assertEqual(res_search.status_code, 200)
        search_results = res_search.json()
        self.assertTrue(any("Space" in r["name"] for r in search_results))

    def test_06_ride_history_time_series(self):
        """Test /api/rides/{ride_id}/history returns both live curve and historical hourly averages."""
        all_rides = self.client.get("/api/rides").json()
        sample_ride_id = all_rides[0]["id"]

        res = self.client.get(f"/api/rides/{sample_ride_id}/history")
        self.assertEqual(res.status_code, 200)
        data = res.json()

        self.assertEqual(data["ride_id"], sample_ride_id)
        self.assertIn("ride_name", data)
        self.assertIn("today_curve", data)
        self.assertIn("hourly_averages", data)

        # Verify hourly averages has entries for operating hours
        self.assertEqual(len(data["hourly_averages"]), 17) # 7 AM to 11 PM
        hour_labels = [h["hour_label"] for h in data["hourly_averages"]]
        self.assertIn("9 AM", hour_labels)
        self.assertIn("12 PM", hour_labels)
        self.assertIn("3 PM", hour_labels)

    def test_07_downtimes_endpoint(self):
        """Test /api/downtimes returns list of closed rides."""
        res = self.client.get("/api/downtimes")
        self.assertEqual(res.status_code, 200)
        downtimes = res.json()
        self.assertIsInstance(downtimes, list)
        for dt in downtimes:
            self.assertIn("ride_id", dt)
            self.assertIn("ride_name", dt)
            self.assertIn("park_name", dt)
            self.assertIn("downtime_minutes", dt)
            self.assertGreaterEqual(dt["downtime_minutes"], 0)

    def test_08_frontend_assets_served(self):
        """Test that index.html and static files are properly served."""
        res_index = self.client.get("/")
        self.assertEqual(res_index.status_code, 200)
        self.assertIn("Disney World", res_index.text)
        self.assertIn("waitCurveChart", res_index.text)

        res_css = self.client.get("/static/css/style.css")
        self.assertEqual(res_css.status_code, 200)

        res_js = self.client.get("/static/js/app.js")
        self.assertEqual(res_js.status_code, 200)

    def test_09_least_busy_days_endpoint(self):
        """Test /api/history/parks/{park_id}/least-busy-days returns rankings and sweet spots."""
        # Test Magic Kingdom (6)
        res_mk = self.client.get("/api/history/parks/6/least-busy-days")
        self.assertEqual(res_mk.status_code, 200)
        data_mk = res_mk.json()
        self.assertEqual(data_mk["park_id"], 6)
        self.assertIn("top_least_busy_days", data_mk)
        self.assertGreater(len(data_mk["top_least_busy_days"]), 0)
        self.assertIn("seasonal_sweet_spots", data_mk)
        self.assertEqual(len(data_mk["seasonal_sweet_spots"]), 4)
        self.assertIn("day_of_week_rankings", data_mk)
        self.assertEqual(len(data_mk["day_of_week_rankings"]), 7)

        # Test Disneyland Park (16)
        res_dl = self.client.get("/api/history/parks/16/least-busy-days")
        self.assertEqual(res_dl.status_code, 200)
        data_dl = res_dl.json()
        self.assertEqual(data_dl["park_id"], 16)
        self.assertEqual(data_dl["resort"], "Disneyland Resort")
        self.assertIn("top_least_busy_days", data_dl)
        self.assertGreater(len(data_dl["top_least_busy_days"]), 0)

if __name__ == "__main__":
    unittest.main()
