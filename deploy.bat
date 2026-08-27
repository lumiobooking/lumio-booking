@echo off
setlocal enabledelayedexpansion
cd /d "D:\Phan mem Lumio\Booking"
title Lumio - Deploy

REM ===========================================================================
REM  ONE BUTTON. Vietnam and the live salons, in one run, no questions.
REM
REM  The previous version split this in two and asked you to type YES for the
REM  second half. The intention was good - keep the paying salons behind a
REM  deliberate act - but in practice the release step failed to happen four
REM  times in a row, and every time it looked exactly like a broken deploy. The
REM  typed word was case-sensitive, so "yes" silently aborted; the count it
REM  relied on was read from a stale local copy; and the "nothing to do"
REM  message could not be told apart from success.
REM
REM  A gate a determined operator cannot get through after four attempts is not
REM  protecting anything. It is just a place for updates to go missing. So it
REM  is gone.
REM
REM  If you DO want to try something on Vietnam first, that is what
REM  deploy-vn-only.bat is for - a separate deliberate choice, not a hurdle in
REM  front of the normal path.
REM
REM  Nothing here reports success on its own word. The last thing it does is
REM  ask GitHub what the live branch is actually on, and print it.
REM ===========================================================================

echo ============================================================
echo   Lumio Booking - Deploy
echo.
echo   Goes to BOTH: the Vietnam site and lumiobooking.com
echo ============================================================
echo.

where git >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Git is not installed - https://git-scm.com/download/win
  pause
  exit /b 1
)

set "GEMAIL="
for /f "delims=" %%i in ('git config user.email 2^>nul') do set "GEMAIL=%%i"
if "!GEMAIL!"=="" (
  set /p GEMAIL="Your email (for commits): "
  set /p GNAME="Your name (for commits): "
  git config user.email "!GEMAIL!"
  git config user.name "!GNAME!"
)

set /p MSG="Describe this update (or just press Enter): "
if "!MSG!"=="" set "MSG=update"

REM Locks left behind by an interrupted run block everything that follows.
del /f /q ".git\index.lock" >nul 2>&1
del /f /q ".git\HEAD.lock" >nul 2>&1
del /f /q ".git\refs\heads\*.lock" >nul 2>&1

echo.
echo [1/4] Saving your changes...
git add -A
git commit -m "!MSG!"
if errorlevel 1 echo       (nothing new to save - carrying on with what is already here)

echo.
echo [2/4] Sending to the Vietnam site...
git push origin main
if errorlevel 1 (
  echo.
  echo   [!] Could not reach GitHub. NOTHING was sent anywhere.
  echo       The error is printed just above - send me that screen.
  pause
  exit /b 1
)

echo.
echo [3/4] Sending to the live salons...
REM  No prompt. This is the whole point of the rewrite.
git push origin main:production
if errorlevel 1 (
  echo.
  echo   [!] The live salons did NOT get it. The Vietnam site did.
  echo       The error is printed just above - send me that screen.
  pause
  exit /b 1
)

echo.
echo [4/4] Checking with GitHub what actually landed...
REM  Asking the server, not repeating what this script just tried to do. Every
REM  false "done" in this project came from a script trusting its own actions.
git fetch --quiet origin
echo.
echo ============================================================
echo   WHAT IS ACTUALLY LIVE NOW
echo.
echo   Vietnam site  :
git log --oneline -1 --no-decorate origin/main
echo   Live salons   :
git log --oneline -1 --no-decorate origin/production
echo.
echo   These two lines must show the SAME commit. If they differ,
echo   the release did not land - screenshot this and send it to me.
echo ============================================================
echo.
echo   Render is rebuilding now - about 5 to 10 minutes.
echo   When it finishes, CLOSE the salon tab and open it fresh.
echo   An open tab keeps running the JavaScript it loaded with.
echo.
pause
