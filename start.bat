@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
set PORT=8901

rem ============================================================
rem  One-click launcher for the 3D terrain studio (Windows)
rem  Starts scripts\serve.py on %PORT% and opens the browser.
rem  Keep this file ASCII-only: cmd.exe reads .bat in the OEM codepage,
rem  non-ASCII text would show up as garbage on most Chinese systems.
rem ============================================================

netstat -ano | findstr /c:"127.0.0.1:%PORT%" | findstr /c:"LISTENING" >nul 2>&1
if not errorlevel 1 (
  echo [i] Server already running on port %PORT%.
  goto open
)

set "PY="
where py >nul 2>&1 && set "PY=py -3"
if not defined PY (
  where python >nul 2>&1 && set "PY=python"
)
if not defined PY (
  echo.
  echo [!] Python 3 was not found on this machine.
  echo     Install it from https://www.python.org/downloads/
  echo     and tick "Add python.exe to PATH" during setup.
  echo.
  pause
  exit /b 1
)

echo [*] Python : %PY%
echo [*] Port   : %PORT%
echo [*] Starting local server ...
start "style-map server" cmd /k "%PY% scripts\serve.py %PORT%"

rem give the server a moment to bind the port
for /l %%i in (1,1,20) do (
  netstat -ano | findstr /c:"127.0.0.1:%PORT%" | findstr /c:"LISTENING" >nul 2>&1
  if not errorlevel 1 goto open
  ping -n 1 -w 300 127.0.0.1 >nul
)
echo [!] Server did not come up in time. Check the "style-map server" window.

:open
echo [*] Opening http://127.0.0.1:%PORT%/?proxy=1
start "" "http://127.0.0.1:%PORT%/?proxy=1"
endlocal
