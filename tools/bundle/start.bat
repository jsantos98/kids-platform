@echo off
title Kids Platform
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
if errorlevel 1 (
  echo.
  echo Something went wrong - see the message above.
  pause
)
