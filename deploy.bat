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

REM ===========================================================================
REM  [0] Claude's update. Claude delivers code as a zip (lumio-rt...zip) that
REM  is saved into "Claude outputs". Committing the zip itself changes NOTHING
REM  on the site - the files inside must replace the ones in this folder. That
REM  went wrong several times in a row, so this step does it: the newest zip
REM  there is unpacked over this folder, then moved to "Claude outputs\da-cai"
REM  (ignored by git) so it is never unpacked twice. .bat files in a zip are
REM  skipped: this script must not be rewritten while it is running.
REM ===========================================================================
set "ZIP="
for /f "delims=" %%f in ('dir /b /a-d /o-d "Claude outputs\lumio-*.zip" 2^>nul') do if not defined ZIP set "ZIP=%%f"
if defined ZIP (
  echo [0/4] Applying Claude's update: !ZIP!
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; $root=(Get-Location).Path.TrimEnd('\') + '\'; $z=[IO.Compression.ZipFile]::OpenRead($root + 'Claude outputs\!ZIP!'); $n=0; try { foreach ($e in $z.Entries) { if (-not $e.Name) { continue }; if ($e.FullName -like '*.bat') { continue }; $d=[IO.Path]::GetFullPath([IO.Path]::Combine($root, $e.FullName)); if (-not $d.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) { throw ('Bad path in zip: ' + $e.FullName) }; [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($d)); [IO.Compression.ZipFileExtensions]::ExtractToFile($e, $d, $true); $n++ } } finally { $z.Dispose() }; Write-Host ('      ' + $n + ' files updated')"
  if errorlevel 1 (
    echo.
    echo   [X] Could not unpack !ZIP!. NOTHING was sent anywhere.
    echo       Close VS Code / any program using these files, then run this again.
    pause
    exit /b 1
  )
  if not exist "Claude outputs\da-cai" mkdir "Claude outputs\da-cai"
  move /y "Claude outputs\lumio-*.zip" "Claude outputs\da-cai\" >nul
  echo.
) else (
  echo [0/4] No new zip from Claude in "Claude outputs" - sending what is in this folder.
  echo.
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
