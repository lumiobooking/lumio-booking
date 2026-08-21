@echo off
setlocal enabledelayedexpansion
cd /d "D:\Phan mem Lumio\Booking"
title Lumio - Release to the US salons

REM ===========================================================================
REM  Send what is on `main` to the US salons.
REM
REM  IT NO LONGER CHECKS OUT ANY BRANCH, AND THAT IS THE WHOLE POINT.
REM
REM  The previous version ran `git checkout production` first. `production` is
REM  an older commit that does not contain THIS FILE, so checking it out
REM  deleted the batch file that was running. cmd.exe reads a .bat line by line
REM  from disk as it executes, so execution simply stopped at that line: the
REM  merge never ran, the push never ran, and the `git checkout main` at the
REM  bottom never ran either. That is why the release silently did nothing, why
REM  the working copy was left sitting on `production`, and why this file
REM  vanished. A script that destroys itself halfway through is not a script
REM  that failed - it is one that cannot report failing.
REM
REM  `git push origin main:production` does the same job from where we already
REM  are. No checkout, no working copy touched, nothing to restore afterwards,
REM  and git refuses a non-fast-forward push unless forced - so the safety that
REM  `--ff-only` was providing is still there, for free.
REM ===========================================================================

echo ============================================================
echo   RELEASE TO THE US SALONS
echo   main  ---^>  production   (lumiobooking.com)
echo ============================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed.
  pause
  exit /b 1
)

REM --- Clear locks left behind by an interrupted git process ---
del /f /q ".git\index.lock" >nul 2>&1
del /f /q ".git\HEAD.lock" >nul 2>&1

REM --- Must be on main. We do not switch for you: being on the wrong branch
REM     usually means something else is half-finished. ---
for /f "delims=" %%b in ('git rev-parse --abbrev-ref HEAD') do set "BRANCH=%%b"
if not "!BRANCH!"=="main" (
  echo [!] You are on branch "!BRANCH!", not "main".
  echo     Nothing was changed. Run:  git checkout main
  echo     then start this again.
  pause
  exit /b 1
)

REM --- Refuse on uncommitted work: what has not been tried does not travel ---
git diff --quiet && git diff --cached --quiet
if errorlevel 1 (
  echo [!] You have uncommitted changes.
  echo     Run "Deploy update" first so Vietnam sees them, try it there,
  echo     and only then release to the US.
  echo.
  git status --short
  pause
  exit /b 1
)

echo Fetching the current state from GitHub...
git fetch origin --quiet
if errorlevel 1 (
  echo [!] Could not reach GitHub. Nothing was changed.
  pause
  exit /b 1
)

REM --- main must itself be pushed, or you would release something GitHub
REM     has never seen ---
for /f "delims=" %%n in ('git rev-list --count origin/main..main') do set "UNPUSHED=%%n"
if not "!UNPUSHED!"=="0" (
  echo [!] main has !UNPUSHED! commit^(s^) that are not on GitHub yet.
  echo     Run "Deploy update" first. Nothing was changed.
  pause
  exit /b 1
)

REM --- Anything to send? ---
for /f "delims=" %%n in ('git rev-list --count origin/production..origin/main') do set "AHEAD=%%n"
if "!AHEAD!"=="0" (
  echo The US is already up to date. Nothing to do.
  pause
  exit /b 0
)

REM --- Would this be a fast-forward? If production has commits main does not,
REM     stop: something was committed straight to production and merging would
REM     throw it away. ---
for /f "delims=" %%n in ('git rev-list --count origin/main..origin/production') do set "DIVERGED=%%n"
if not "!DIVERGED!"=="0" (
  echo [!] production has !DIVERGED! commit^(s^) that main does not have.
  echo     This cannot fast-forward and nothing was changed.
  echo     Send this screen to Claude before doing anything else.
  pause
  exit /b 1
)

echo.
echo The US salons are about to receive !AHEAD! commit^(s^):
echo ------------------------------------------------------------
git log --oneline --no-decorate origin/production..origin/main
echo ------------------------------------------------------------
echo.
echo Have these been tried on the Vietnam test site already?
set /p CONFIRM="Type YES (capitals) to release, anything else to cancel: "
if not "!CONFIRM!"=="YES" (
  echo Cancelled. Nothing was changed.
  pause
  exit /b 0
)

echo.
echo Releasing...
git push origin main:production
if errorlevel 1 (
  echo.
  echo [!] Push refused. NOTHING reached the US - your files are untouched.
  echo     Send this screen to Claude.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Released. Render is rebuilding lumiobooking.com now.
echo.
echo   Check it landed - the "commit" value should change:
echo   https://lumio-api-uqm6.onrender.com/api/health
echo ============================================================
echo.
echo You are still on branch main. Nothing on your computer changed.
pause
