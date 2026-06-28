@echo off
title Lumio Print Agent
cd /d "%~dp0"
:loop
node index.js
echo.
echo Print agent stopped. Restarting in 5 seconds... (close this window to quit)
timeout /t 5 /nobreak >nul
goto loop
