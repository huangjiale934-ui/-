@echo off
REM 2026-10-23: daily data refresh + push (Windows Task Scheduler entry)
REM 1) tools/daily.sh    : scrape issuers, rebuild hist/navperf/index
REM 2) tools/push-task.sh: upload funds + last-10-day hist patch + navperf to the live site
REM Log: tmp\daily-task.log
setlocal
chcp 65001 >nul
set "APP=D:\2026-10-08-11-05-17\mpf-app"
set "BASH=C:\Users\11718\AppData\Local\Programs\WorkBuddy\resources\vendor\PortableGit\bin\bash.exe"
pushd "%APP%"
if not exist "tmp" mkdir "tmp"
"%BASH%" tools/daily.sh >> "tmp\daily-task.log" 2>&1
echo [task] daily.sh exit=%ERRORLEVEL% >> "tmp\daily-task.log"
"%BASH%" tools/push-task.sh >> "tmp\daily-task.log" 2>&1
echo [task] push exit=%ERRORLEVEL% >> "tmp\daily-task.log"
popd
exit /b 0
