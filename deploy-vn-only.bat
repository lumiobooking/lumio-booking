@echo off
setlocal enabledelayedexpansion
cd /d "D:\Phan mem Lumio\Booking"
title Lumio - Deploy to Vietnam only

REM ===========================================================================
REM  The careful path, for when you want to try something on the Vietnam site
REM  before the paying salons see it.
REM
REM  This used to be the DEFAULT, with the release to the live salons hidden
REM  behind a typed confirmation. That got it backwards: the common case became
REM  the hard one, and four releases in a row went missing because the second
REM  step never happened. Now the normal path is deploy.bat, which does both,
REM  and this file is here for the times you deliberately want to hold back.
REM
REM  When you are happy with it on Vietnam, run deploy.bat to send it live.
REM ===========================================================================

echo ============================================================
echo   Vietnam site ONLY
echo   lumiobooking.com will NOT change.
echo ============================================================
echo.

del /f /q ".git\index.lock" >nul 2>&1

set /p MSG="Describe this update (or just press Enter): "
if "!MSG!"=="" set "MSG=update"

echo.
git add -A
git commit -m "!MSG!"
if errorlevel 1 echo (nothing new to save - carrying on)

echo.
echo Sending to the Vietnam site...
git push origin main
if errorlevel 1 (
  echo.
  echo   [!] Could not reach GitHub. Nothing was sent.
  echo       Send me the error printed above.
  pause
  exit /b 1
)

git fetch --quiet origin
echo.
echo ============================================================
echo   Vietnam site  :
git log --oneline -1 --no-decorate origin/main
echo   Live salons   :  (unchanged, on purpose)
git log --oneline -1 --no-decorate origin/production
echo ============================================================
echo.
echo   Run deploy.bat when you want the salons to have it too.
echo.
pause
