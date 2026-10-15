@echo off
rem Open3DKesuni printer bridge: keeps running and restarts by itself. Close this window to stop it.
cd /d "%~dp0.."
title Open3DKesuni printer bridge
:loop
node scripts\printer-bridge.mjs
echo.
echo Bridge stopped (exit code %errorlevel%). Restarting in 30 seconds. Close this window to stop.
timeout /t 30 /nobreak >nul
goto loop
