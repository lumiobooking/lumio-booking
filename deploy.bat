@echo off
setlocal enabledelayedexpansion
cd /d "D:\Phan mem Lumio\Booking"
title Lumio - Deploy update (Vietnam)

echo ============================================================
echo   Lumio Booking - push update
echo.
echo   This goes to the VIETNAM system only.
echo   The US and Canada salons are NOT affected.
echo.
echo   When you are happy with it there, run "deploy-to-us.bat"
echo   to release it to the paying salons.
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
echo.
echo   Pushed. The Vietnam test site is rebuilding.
echo.

REM ===========================================================================
REM  Release to the live salons, in the SAME run.
REM
REM  This used to be a separate script you had to remember afterwards, and six
REM  times in a row an update was reported as "nothing changed" when the truth
REM  was that step two never happened. A gate whose state nobody can see is not
REM  a gate, it is a trap: the failure looks identical to a broken deploy, so
REM  the time goes into hunting the wrong thing.
REM
REM  Still a deliberate act - you type YES or you do not - but now in front of
REM  you while you are thinking about the change, instead of waiting in a file
REM  whose name you have to recall.
REM ===========================================================================
set "AHEAD=0"
for /f "delims=" %%n in ('git rev-list --count origin/production..main 2^>nul') do set "AHEAD=%%n"
if "!AHEAD!"=="0" (
  echo ============================================================
  echo   The live salons already have this. Nothing more to do.
  echo ============================================================
  pause
  exit /b 0
)

echo ============================================================
echo   RELEASE TO THE LIVE SALONS?   ^(lumiobooking.com^)
echo ============================================================
echo.
echo   !AHEAD! change^(s^) would go out:
echo.
git log --oneline --no-decorate origin/production..main
echo.
echo   Leave blank to stop here and test on the Vietnam site first.
set /p GOLIVE="Type YES to send it live now: "
if not "!GOLIVE!"=="YES" (
  echo.
  echo   Stopped. Nothing reached the live salons.
  echo   Run this again when ready, or use deploy-to-us.bat.
  pause
  exit /b 0
)

echo.
echo Releasing...
git push origin main:production
if errorlevel 1 (
  echo.
  echo   [!] Push refused. NOTHING reached the live salons.
  echo       Send this screen to Claude.
  pause
  exit /b 1
)

echo.
echo ============================================================
echo   Live. Render is rebuilding lumiobooking.com now (5-10 min).
echo.
echo   When it finishes, CLOSE the salon tab and open it again -
echo   an open tab keeps running the JavaScript it loaded with.
echo ============================================================
pause
