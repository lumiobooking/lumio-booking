@echo off
setlocal enabledelayedexpansion
cd /d "D:\Phan mem Lumio\Booking"
title Lumio - Release to US salons

REM ===========================================================================
REM  Releases what is already running in Vietnam to the US and Canadian salons.
REM
REM  Vietnam watches `main`; the US watches `production`. So "Deploy update"
REM  reaches Vietnam and stops there. This script merges main into production,
REM  which is the moment the paying salons receive anything.
REM
REM  It is a separate script on purpose. The two actions have very different
REM  consequences, and they should not share a button.
REM ===========================================================================

echo ============================================================
echo   RELEASE TO THE US / CANADA SALONS
echo.
echo   This sends what Vietnam is running to the shops who are
echo   running their business on it today.
echo ============================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed.
  pause
  exit /b 1
)

del /f /q ".git\index.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1

REM --- Nothing uncommitted may ride along unnoticed ---
for /f "delims=" %%i in ('git status --porcelain') do set "DIRTY=1"
if defined DIRTY (
  echo [!] You have changes that are not committed yet.
  echo     Run "Deploy update" first so Vietnam gets them, try them there,
  echo     and only then release to the US.
  echo.
  git status --short
  pause
  exit /b 1
)

echo Fetching latest from GitHub...
git fetch origin --prune
if errorlevel 1 (
  echo [!] Could not reach GitHub. Check your connection and try again.
  pause
  exit /b 1
)

REM --- Create production on the first run, from whatever the US runs now ---
git show-ref --verify --quiet refs/remotes/origin/production
if errorlevel 1 (
  echo First run: creating the "production" branch from main...
  git branch -f production origin/main
  git push -u origin production
  if errorlevel 1 (
    echo [!] Could not create the production branch.
    pause
    exit /b 1
  )
  echo Done. The US services must now be set to watch "production" in Render.
  echo.
  pause
  exit /b 0
)

REM --- Show exactly what the US is about to receive ---
echo.
echo ------------------------------------------------------------
echo  What the US salons do NOT have yet:
echo ------------------------------------------------------------
git log --oneline origin/production..origin/main
if errorlevel 1 goto :nothing

for /f %%i in ('git rev-list --count origin/production..origin/main') do set "AHEAD=%%i"
if "!AHEAD!"=="0" (
  :nothing
  echo   ^(nothing - the US is already up to date^)
  echo.
  pause
  exit /b 0
)
echo ------------------------------------------------------------
echo   !AHEAD! change^(s^) will go live for the paying salons.
echo.

REM --- Ask before touching production. This is the irreversible part. ---
set /p CONFIRM="Have you tried these in Vietnam already? Type YES to release: "
if /i not "!CONFIRM!"=="YES" (
  echo Cancelled. Nothing was released.
  pause
  exit /b 0
)

echo.
echo Releasing...
git checkout production 2>nul || git checkout -b production origin/production
git reset --hard origin/production
git merge --ff-only origin/main
if errorlevel 1 (
  echo.
  echo [!] production has commits that main does not, so this cannot fast-forward.
  echo     Nothing was changed. Send this screen to Claude before continuing.
  git checkout main
  pause
  exit /b 1
)

git push origin production
if errorlevel 1 (
  echo [!] Push failed. Nothing reached the US.
  git checkout main
  pause
  exit /b 1
)

git checkout main

echo.
echo ============================================================
echo   Released. Render is rebuilding lumio-api and lumio-web.
echo.
echo   The build runs the guard tests first, so if anything US
echo   salons depend on has changed, the deploy stops instead.
echo.
echo   Check which version is live:
echo   https://lumio-api.onrender.com/api/health
echo ============================================================
pause
