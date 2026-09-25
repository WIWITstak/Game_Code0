@echo off
cd /d "%~dp0"
call npm run editor
if errorlevel 1 pause
