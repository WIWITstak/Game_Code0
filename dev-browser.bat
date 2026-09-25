@echo off
rem Dev only: serve the game and open it in your default browser (for devtools).
rem To just play, use MARS.bat / MARS.vbs instead.
cd /d "%~dp0"
start "MARS dev server" cmd /k node server.js
timeout /t 1 /nobreak >nul
start "" http://127.0.0.1:8080/
