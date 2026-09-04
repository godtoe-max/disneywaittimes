"""
Entry point to run the Disney World Wait Times Tracker application.
Usage: python run.py
"""

import uvicorn

if __name__ == "__main__":
    print("Starting Disney World Wait Times Tracker on http://127.0.0.1:8000 ...")
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=False, log_level="info")
