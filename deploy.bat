@echo off
setlocal enabledelayedexpansion
cd /d "D:\Phan mem Lumio\Booking"
title Lumio - Deploy update to online

echo ============================================================
echo   Lumio Booking - push update to ONLINE
echo   (Render rebuilds and redeploys automatically on push)
echo ============================================================
echo.

REM --- Check Git is installed ---
where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed.
  echo Download it from https://git-scm.com/download/win then run this again.
  pause
  exit /b 1
)

REM --- First-time setup: init repo + connect to GitHub ---
if not exist ".git" (
  echo First run detected. Setting up the Git repository...
  git init
  git branch -M main
  echo.
  echo Paste the GitHub repository URL you created
  echo  ^(example: https://github.com/yourname/lumio-booking.git^)
  set /p REPOURL="Repo URL: "
  git remote add origin !REPOURL!
  echo.
)

REM --- Ensure a commit identity exists (first time only) ---
set "GEMAIL="
for /f "delims=" %%i in ('git config user.email 2^>nul') do set "GEMAIL=%%i"
if "!GEMAIL!"=="" (
  set /p GEMAIL="Your email (for commits): "
  set /p GNAME="Your name (for commits): "
  git config user.email "!GEMAIL!"
  git config user.name "!GNAME!"
)

REM --- Commit message ---
echo.
set /p MSG="Describe this update (press Enter for 'update'): "
if "!MSG!"=="" set "MSG=update"

echo.
REM --- Clear any stale git locks left by an interrupted process ---
del /f /q ".git\index.lock" >nul 2>&1
del /f /q ".git\HEAD.lock" >nul 2>&1
del /f /q ".git\ORIG_HEAD.lock" >nul 2>&1
del /f /q ".git\config.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1

echo Staging changes...
git add -A
git commit -m "!MSG!"
if errorlevel 1 echo (No new changes to commit - will still push the latest.)

echo.
echo Pushing to GitHub...
git push -u origin main
if errorlevel 1 (
  echo.
  echo [!] Push failed.
  echo     - First push: a GitHub login window usually appears - sign in once.
  echo     - Or check that the repo URL is correct.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Done! Your update was pushed.
echo   Render is now rebuilding ^& redeploying automatically.
echo   Watch progress: https://dashboard.render.com
echo ============================================================
pause
