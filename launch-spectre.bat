@echo off
cd /d C:\Users\USER\Documents\Spectre
echo Starting Spectre Next.js app at http://localhost:3000
echo Press Ctrl+C to stop.
echo.
start "" cmd /c "timeout /t 4 /nobreak >nul && start "" http://localhost:3000"
npm run dev
