@echo off
REM 2026-10-23: daily health check of the live site (Windows Task Scheduler entry)
REM Reports: data\health\<date>.json  Log: tmp\health.log
setlocal
chcp 65001 >nul
set "APP=D:\2026-10-08-11-05-17\mpf-app"
set "NODE=C:\Users\11718\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
pushd "%APP%"
if not exist "tmp" mkdir "tmp"
echo ===== %date% %time% ===== >> "tmp\health.log"
"%NODE%" tools\health-check.js >> "tmp\health.log" 2>&1
echo [health] exit=%ERRORLEVEL% >> "tmp\health.log"
popd
exit /b 0
