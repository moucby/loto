@echo off
title Loto
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe : https://nodejs.org
  pause
  exit /b 1
)
node serveur.js
pause
