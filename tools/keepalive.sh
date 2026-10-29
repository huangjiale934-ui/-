#!/usr/bin/env bash
# 站点保活（2026-10-29，5.0）
# 背景：WorkBuddy 沙箱冷启动偶发 504，首次访问需 30–60 秒。定时 ping 可显著降低冷启动概率。
# 用法：bash tools/keepalive.sh            # 打一次
#       crontab / 计划任务每 10–15 分钟调用一次
set -u
BASE="${1:-https://mpf-data.app.workbuddy.host}"
for i in 1 2 3; do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 25 "$BASE/api/ping")
  ts=$(date '+%F %T')
  if [ "$code" = "200" ]; then echo "[$ts] ok  $BASE"; exit 0; fi
  echo "[$ts] $code  $BASE（第 $i 次，重试）"
  sleep 5
done
exit 1
