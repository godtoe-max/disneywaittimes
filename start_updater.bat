@echo off
title Disney Parks Wait Times Tracker & Poller (WDW & Disneyland)
cd /d "%~dp0"
echo =======================================================
echo   Disney Parks Wait Time Tracker & 5-Minute Poller
echo   Walt Disney World (FL) & Disneyland Resort (CA)
echo =======================================================
echo.
echo Starting FastAPI server and APScheduler worker...
echo Web Dashboard available at: http://127.0.0.1:8000
echo Polling all 6 Disney parks (197 attractions) every 5 minutes.
echo Enforcing 365-day rolling retention archive (2021 to Present).
echo.
echo Press Ctrl+C in this window to stop.
echo =======================================================
echo.
python run.py
pause
