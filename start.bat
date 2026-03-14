@echo off
title Sahakar Pharmacy - Dev Server

echo [*] Killing any stale uvicorn processes...
taskkill /IM uvicorn.exe /F >nul 2>&1
timeout /t 1 /nobreak >nul

echo [*] Starting backend (port 8000)...
start "Backend - uvicorn" cmd /k "cd /d %~dp0backend && C:\Users\LENOVO\AppData\Local\Programs\Python\Python313\python.exe -m uvicorn server:app --reload --host 0.0.0.0 --port 8000"

echo [*] Starting frontend (port 3000)...
start "Frontend - React" cmd /k "cd /d %~dp0frontend && npm start"

echo.
echo [+] Backend:  http://localhost:8000
echo [+] Frontend: http://localhost:3000
echo [+] API docs: http://localhost:8000/docs
echo.
pause
