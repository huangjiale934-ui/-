@echo off
REM 2026-10-24: manual health check with on-screen output (desktop shortcut)
REM Same check as the 09:00 scheduled task, but prints to the window and waits for a key.
setlocal
chcp 65001 >nul
set "APP=D:\2026-10-08-11-05-17\mpf-app"
set "NODE=C:\Users\11718\.workbuddy\binaries\node\versions\22.22.2-6\node.exe"
pushd "%APP%"
if not exist "tmp" mkdir "tmp"
echo.
echo 正在体检线上站点，请稍候（约 10-20 秒）...
echo.
"%NODE%" tools\health-check.js > "tmp\health-last.txt" 2>&1
type "tmp\health-last.txt"
echo.
echo ===== %date% %time% ===== >> "tmp\health.log"
type "tmp\health-last.txt" >> "tmp\health.log"
popd
echo.
echo 结果已写入 data\health\ 与 tmp\health.log
pause
