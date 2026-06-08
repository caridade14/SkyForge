@echo off
cd /d "%~dp0"
node server.js >> "%~dp0server-run.log" 2>&1
