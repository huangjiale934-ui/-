@echo off
chcp 65001 >nul
echo ============================================
echo  强积金平台 - 每日更新任务状态
echo ============================================
schtasks /query /tn "MPF-Daily-Update" /v /fo LIST | findstr /C:"任务名" /C:"下次运行" /C:"上次运行" /C:"上次结果"
echo.
echo --- 最近 20 行运行日志 ---
"C://Users//11718//.workbuddy//binaries//node//versions//22.22.2-6//node.exe" -e "const fs=require('fs');const p='D:/2026-10-08-11-05-17/mpf-app/tmp/daily-task.log';if(!fs.existsSync(p)){console.log('(还没有日志，等今晚 22:30 首次运行)');process.exit(0)}const l=fs.readFileSync(p,'utf8').trim().split('\n');console.log(l.slice(-20).join('\n'))"
echo.
pause
