@echo off
cd /d "%~dp0"
start "SocioLab Server" /b node server.js
timeout /t 2 /nobreak >nul
start "SocioLab" http://127.0.0.1:4173
