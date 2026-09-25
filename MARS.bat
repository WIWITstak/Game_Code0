@echo off
rem Quick launch — double-click to play. First run installs Electron (~190 MB).
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo First run: installing dependencies, this takes a few minutes...
  call npm install
  if not exist "node_modules\electron\dist\electron.exe" (
    echo.
    echo npm install failed. Make sure Node.js is installed, then run this again.
    pause
    exit /b 1
  )
)

start "" "node_modules\electron\dist\electron.exe" "%~dp0."
exit /b 0
