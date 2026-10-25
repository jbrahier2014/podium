@echo off
rem Double-click to upload the latest changes to GitHub.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup\publish.ps1"
