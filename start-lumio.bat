@echo off
REM ============================================================
REM  Lumio Booking - one-click launcher
REM  Stops old Node processes, cleans the API build, then opens
REM  the backend (API :8005) and frontend (Web :3005) in two
REM  separate windows.
REM ============================================================
title Lumio launcher
cd /d "D:\Phan mem Lumio\Booking"

echo.
echo [1/4] Stopping any running Node processes...
taskkill /F /IM node.exe >nul 2>&1

echo [2/4] Cleaning API build folder...
if exist "apps\api\dist" rmdir /s /q "apps\api\dist"

echo [3/4] Starting backend  - API  http://localhost:8005 ...
start "Lumio API (8005)" /D "D:\Phan mem Lumio\Booking" cmd /k "npm run dev:api"

echo      Waiting a few seconds for the API to boot...
timeout /t 7 /nobreak >nul

echo [4/4] Starting frontend - Web  http://localhost:3005 ...
start "Lumio Web (3005)" /D "D:\Phan mem Lumio\Booking" cmd /k "npm run dev:web"

echo.
echo ============================================================
echo  Done. Two windows opened:
echo    - Lumio API (8005)
echo    - Lumio Web (3005)
echo.
echo  Admin dashboard : http://localhost:3005
echo  Customer booking: http://localhost:3005/book/salon-a
echo ============================================================
echo  This launcher window will close in 6 seconds.
timeout /t 6 /nobreak >nul
