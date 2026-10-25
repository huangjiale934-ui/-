@echo off
REM 2026-10-23: quarterly holdings refresh (monthly on 5/10/15/20/25/28 at 22:00)
REM Runs tools/quarterly.sh, which retries until 90 percent of funds have the latest report period.
REM Log: tmp\quarterly-task.log
setlocal
chcp 65001 >nul
set "APP=D:\2026-10-08-11-05-17\mpf-app"
set "BASH=C:\Users\11718\AppData\Local\Programs\WorkBuddy\resources\vendor\PortableGit\bin\bash.exe"
pushd "%APP%"
if not exist "tmp" mkdir "tmp"
echo ===== %date% %time% ===== >> "tmp\quarterly-task.log"
"%BASH%" tools/quarterly.sh >> "tmp\quarterly-task.log" 2>&1
echo [quarterly] exit=%ERRORLEVEL% >> "tmp\quarterly-task.log"
popd
exit /b 0
