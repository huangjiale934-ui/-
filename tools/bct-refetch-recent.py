#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
BCT 官网最近若干交易日净值复核 / 修正（只针对已入库的 BCT 来源基金）
原因：BCT 的 fundInformation 接口在 2026-10-30 / 11-02 前后曾短暂返回错误净值，
      本地与 GitHub 两次抓取各拿到过一次错值，导致个别基金净值序列出现「尖峰回吐」。
用法：
  python tools/bct-refetch-recent.py            # 只比对，不改文件
  python tools/bct-refetch-recent.py --apply    # 把不一致的点改为官网当前值
"""
import io, json, os, sys, time, datetime

try:
    from curl_cffi import requests as cffi
except Exception as e:
    print("需要 curl_cffi：", e); sys.exit(1)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HIST = os.path.join(BASE, "data", "hist")
INDEX = os.path.join(BASE, "data", "hist-index.json")
APPLY = "--apply" in sys.argv
API = "https://www.bcthk.com/bin/servlet/fundInformation"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}

PLANS = ["pro-choice", "series-800", "strategic-mpf", "smart-plan", "industry-choice", "simple-plan"]
DAYS = int(next((a.split("=")[1] for a in sys.argv if a.startswith("--days=")), 12))

idx = json.load(io.open(INDEX, encoding="utf-8"))["funds"]
by_key = {}
for fid, v in idx.items():
    if str(v.get("src", "")).startswith("bct"):
        key = (v.get("code") or "") + "-" + (v.get("unit") or "")
        by_key[key] = (fid, v)

# 最近 N 个自然日（BCT 只返回有净值的日期，请求无数据的日期会回退到上一交易日）
today = datetime.date(2026, 11, 4)
dates = [(today - datetime.timedelta(days=i)).isoformat() for i in range(DAYS, -1, -1)]

diffs, checked, applied = [], 0, 0
for plan in PLANS:
    for d in dates:
        try:
            r = cffi.get(API, params={"lang": "zh", "schemaInfoId": plan, "date": d},
                         headers=UA, impersonate="chrome", timeout=45)
            lst = ((r.json().get("data") or {}).get("fundInformationList") or [])
        except Exception as e:
            print("抓取失败", plan, d, e); continue
        for row in lst:
            fpd = row.get("fundPerformanceDetail") or {}
            if fpd.get("priceDate") != d:
                continue                      # 该日无净值，接口回退了，跳过
            key = (row.get("code") or "") + "-" + (row.get("unitClass") or "")
            hit = by_key.get(key)
            if not hit:
                continue
            fid, meta = hit
            try:
                px = round(float(fpd.get("price")), 4)
            except Exception:
                continue
            p = os.path.join(HIST, fid + ".json")
            if not os.path.exists(p):
                continue
            obj = json.load(io.open(p, encoding="utf-8"))
            s = obj.get("series") or []
            pos = next((i for i, x in enumerate(s) if x[0] == d), -1)
            checked += 1
            if pos < 0:
                continue
            old = float(s[pos][1])
            if abs(old - px) > 0.0002 * max(1.0, abs(px)):
                diffs.append((fid, meta.get("name"), d, old, px))
                if APPLY:
                    s[pos][1] = px
                    last = s[-1]
                    obj["last"] = last[1]
                    obj["asOf"] = last[0]
                    obj["points"] = len(s)
                    io.open(p, "w", encoding="utf-8", newline="").write(json.dumps(obj, ensure_ascii=False))
                    applied += 1
        time.sleep(0.05)

print("比对 %d 个(基金×日期) 组合，发现差异 %d 处%s" % (checked, len(diffs), "，已写入 %d 处" % applied if APPLY else "（未写入）"))
for d in diffs[:40]:
    print("  · %s %s %s：%.4f → %.4f" % d)
