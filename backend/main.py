"""
FastAPI application for Disney World Wait Time Tracker.
Provides REST endpoints for live wait times, historical rolling averages,
downtime tracking, manual sync, and serves the frontend dashboard.
"""

import os
import logging
from contextlib import asynccontextmanager
from typing import Optional, List
from pydantic import BaseModel

from fastapi import FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from backend.database import init_db
from backend.worker import poll_all_parks
from backend.services import (
    get_parks_summary,
    get_park_live_waits,
    get_all_rides,
    get_ride_history,
    get_current_downtimes,
    seed_demo_history_if_needed,
    get_historical_overview,
    get_attraction_historical_deepdive,
    get_historical_calendar,
    get_ride_day_details,
    get_ride_available_dates,
    evaluate_wishlist,
    get_park_least_busy_days,
)

logger = logging.getLogger("api")
scheduler = AsyncIOScheduler()

FRONTEND_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend")

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifecycle manager:
    Initializes database, runs initial poll, seeds history if needed,
    and starts the 5-minute background polling scheduler.
    """
    logger.info("Initializing Disney World Wait Times database...")
    init_db()

    # Initial live sync
    try:
        logger.info("Running initial live data sync from Queue-Times...")
        await poll_all_parks()
        seed_demo_history_if_needed(days=7)
    except Exception as exc:
        logger.error(f"Error during initial sync: {exc}")

    # Start scheduled worker (runs every 5 minutes)
    logger.info("Starting background scheduler (polling every 5 minutes)...")
    scheduler.add_job(
        poll_all_parks,
        "interval",
        minutes=5,
        id="disney_wait_times_poll",
        replace_existing=True,
    )
    scheduler.start()

    yield

    logger.info("Shutting down background scheduler...")
    scheduler.shutdown(wait=False)

app = FastAPI(
    title="Disney World Wait Times Tracker",
    description="Live and historical wait time analytics for Walt Disney World parks",
    version="1.0.0",
    lifespan=lifespan,
)

# Enable CORS for local development / testing
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# API Endpoints
@app.get("/api/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "ok", "app": "Disney World Wait Time Tracker"}

@app.get("/api/parks")
async def get_parks():
    """
    Get live high-level overview cards for each of the 4 Disney World parks:
    Magic Kingdom, EPCOT, Hollywood Studios, and Animal Kingdom.
    """
    try:
        return get_parks_summary()
    except Exception as exc:
        logger.error(f"Error fetching parks summary: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/parks/{park_id}/live")
async def get_park_live(park_id: int):
    """
    Get current live wait times and ride status for a specific park,
    grouped by land.
    """
    data = get_park_live_waits(park_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Park with ID {park_id} not found")
    return data

@app.get("/api/rides")
async def search_rides(
    park_id: Optional[int] = Query(None, description="Filter by Park ID"),
    search: Optional[str] = Query(None, description="Search by attraction name"),
    open_only: Optional[bool] = Query(None, description="Filter open attractions"),
):
    """
    Search and filter attractions across parks with live wait times and open status.
    """
    try:
        return get_all_rides(park_id=park_id, search=search, open_only=open_only)
    except Exception as exc:
        logger.error(f"Error searching rides: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/rides/{ride_id}/history")
async def get_ride_time_series(ride_id: int):
    """
    Get time-series data for a ride:
    - Today's live wait curve (polled data).
    - Historical hourly rolling average curve (average wait time per hour).
    """
    data = get_ride_history(ride_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Ride with ID {ride_id} not found")
    return data

@app.get("/api/history/overview")
async def get_history_summary():
    """
    Get resort-wide summary of imported historical data from TouringPlans:
    total records, actual timer observations, date ranges, and per-attraction breakdown.
    """
    try:
        return get_historical_overview()
    except Exception as exc:
        logger.error(f"Error fetching historical overview: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/history/attractions/{ride_id}")
async def get_attraction_deepdive(ride_id: int):
    """
    Get deep historical metrics for an attraction:
    - Hourly average posted vs actual wait times
    - Sunday vs Saturday vs Weekday averages
    - Peak vs lowest wait hours
    """
    data = get_attraction_historical_deepdive(ride_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Attraction with ID {ride_id} not found")
    return data

@app.get("/api/history/calendar")
async def get_calendar(
    limit: int = Query(50, description="Max days to return"),
    holiday_only: bool = Query(False, description="Filter for holiday events only"),
):
    """
    Query historical crowd calendar, holiday markers, and weather.
    """
    try:
        return get_historical_calendar(limit=limit, holiday_only=holiday_only)
    except Exception as exc:
        logger.error(f"Error fetching historical calendar: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/history/parks/{park_id}/least-busy-days")
async def get_least_busy_days_endpoint(park_id: int):
    """
    Get the Top 10 least busy days of the year, best days of the week,
    and optimal seasonal travel windows for a specific theme park.
    """
    data = get_park_least_busy_days(park_id)
    if not data:
        raise HTTPException(status_code=404, detail=f"Park with ID {park_id} not found")
    return data

@app.get("/api/history/rides/{ride_id}/dates")
async def get_ride_dates(ride_id: int):
    """
    Get date bounds and popular holiday presets for an attraction.
    """
    return get_ride_available_dates(ride_id)

@app.get("/api/history/rides/{ride_id}/day")
async def get_ride_day(
    ride_id: int,
    date: str = Query(..., description="Target date in YYYY-MM-DD format"),
):
    """
    Get full timeline, metadata, and actual vs posted queue times for a specific day.
    """
    data = get_ride_day_details(ride_id, date)
    if not data:
        raise HTTPException(status_code=404, detail=f"No data found for ride {ride_id} on {date}")
    return data

class WishlistRequest(BaseModel):
    park_id: int
    date: str
    ride_ids: List[int]
    family_size: int = 5

@app.post("/api/planner/wishlist-evaluation")
async def post_wishlist_evaluation(body: WishlistRequest):
    """
    Evaluate a family's selected attraction wishlist for a specific date:
    - Sums cumulative standby queue time in minutes and hours
    - Computes hours saved with Lightning Lane
    - Delivers an objective Lightning Lane stewardship verdict (Recommended, Optional Split, Skip)
    """
    try:
        return evaluate_wishlist(
            park_id=body.park_id,
            date_str=body.date,
            ride_ids=body.ride_ids,
            family_size=body.family_size,
        )
    except Exception as exc:
        logger.error(f"Error evaluating wishlist: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.get("/api/downtimes")
async def get_downtimes():
    """
    Identify current attraction downtimes (rides where is_open = false).
    """
    try:
        return get_current_downtimes()
    except Exception as exc:
        logger.error(f"Error fetching downtimes: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/sync")
async def trigger_sync():
    """
    Trigger an immediate on-demand poll of all 4 Disney World parks.
    """
    try:
        summary = await poll_all_parks()
        return summary
    except Exception as exc:
        logger.error(f"Error during manual sync: {exc}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(exc))

# Frontend Static Assets & Page
if os.path.isdir(FRONTEND_DIR):
    css_dir = os.path.join(FRONTEND_DIR, "css")
    js_dir = os.path.join(FRONTEND_DIR, "js")
    data_dir = os.path.join(FRONTEND_DIR, "data")
    if os.path.isdir(css_dir):
        app.mount("/css", StaticFiles(directory=css_dir), name="css")
    if os.path.isdir(js_dir):
        app.mount("/js", StaticFiles(directory=js_dir), name="js")
    if os.path.isdir(data_dir):
        app.mount("/data", StaticFiles(directory=data_dir), name="data")
    app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/sw.js")
async def serve_sw():
    """Serve Service Worker at root scope for device lock screen notifications."""
    sw_file = os.path.join(FRONTEND_DIR, "sw.js")
    if os.path.isfile(sw_file):
        return FileResponse(sw_file, media_type="application/javascript")
    raise HTTPException(status_code=404, detail="Service worker not found")

@app.get("/manifest.json")
async def serve_manifest():
    """Serve Web App Manifest for mobile PWA support."""
    manifest_file = os.path.join(FRONTEND_DIR, "manifest.json")
    if os.path.isfile(manifest_file):
        return FileResponse(manifest_file, media_type="application/manifest+json")
    raise HTTPException(status_code=404, detail="Manifest not found")

@app.get("/")
async def serve_index():
    """Serve frontend single-page dashboard."""
    index_file = os.path.join(FRONTEND_DIR, "index.html")
    if os.path.isfile(index_file):
        return FileResponse(index_file)
    return JSONResponse(
        status_code=404,
        content={"message": "Frontend not built yet. Index file not found at " + index_file},
    )

