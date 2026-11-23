# -*- coding: utf-8 -*-
"""
宏利官网「基金详情」API 抓取 —— 前十大持仓 + 组合分布 + 官方回报（总部在 scmpf.manulife.com.hk）
====================================================================
数据源：https://scmpf.manulife.com.hk/bin/funds/funddetail?id={code}&productLine=mpf&overrideLocale=zh_Hant_HK
  （须用 curl_cffi 浏览器指纹；净值为每日、持仓/分布为季度更新，asOfDate 为 UTC 时间戳需 +8h 转 HKT）
输出：
  · data/holdings.json —— 合并写入（{source, count, funds: {id: {asOf, top10:[{name,weight}], alloc:[{label,weight}]}}}）
    → 自动点亮详情页「前十大持仓 / 投资组合分布」区块
  · data/trustee-perf.json —— 合并写入宏利官方口径（ytd/y1/y3/y5/since + 历年回报，src=manulife）
用法：python fetch-manulife-detail.py [--only 695,802]
"""
import datetime as dt
import glob
import json
import os
import sys
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
API = "https://scmpf.manulife.com.hk/bin/funds/funddetail"

SRC_LABEL = "宏利官网基金详情（季度）"


def hkt_date(s):
    """UTC ISO 时间戳 → HKT 日期；裸日期原样返回。"""
    if not s:
        return ""
    s = str(s)
    if "T" not in s:
        return s[:10]
    try:
        t = dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
        return (t + dt.timedelta(hours=8)).date().isoformat()
    except ValueError:
        return s[:10]


def num(v):
    try:
        return float(str(v).replace("%", "").replace(",", ""))
    except (TypeError, ValueError):
        return None


def fetch_one(code, retries=3):
    for i in range(retries):
        try:
            r = cffi.get(API, params={"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"},
                         impersonate="chrome", timeout=45)
            if r.status_code == 200:
                j = r.json()
                if j.get("details"):
                    return j["details"]
            if i < retries - 1:
                time.sleep(1.5 + i)
        except Exception:  # noqa: BLE001
            if i < retries - 1:
                time.sleep(1.5 + i)
    return None


def main():
    only = None
    if "--only" in sys.argv:
        only = set(sys.argv[sys.argv.index("--only") + 1].split(","))

    # 读取已接入的宏利系（hist 文件带 code）
    targets = []
    for fp in glob.glob(os.path.join(HIST_DIR, "*.json")):
        try:
            h = json.load(open(fp, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if "宏利" in str(h.get("src", "")) and h.get("code"):
            fid = str(h["id"])
            if only and fid not in only:
                continue
            targets.append((fid, h["code"], h.get("name", "")))
    targets.sort()
    print("宏利系目标 %d 只" % len(targets), flush=True)

    hld = {"updatedAt": 0, "source": SRC_LABEL, "count": 0, "funds": {}}
    if os.path.exists(os.path.join(DATA, "holdings.json")):
        try:
            hld = json.load(open(os.path.join(DATA, "holdings.json"), encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    perf = {"updatedAt": 0, "source": "发行人官网", "count": 0, "funds": {}}
    if os.path.exists(os.path.join(DATA, "trustee-perf.json")):
        try:
            perf = json.load(open(os.path.join(DATA, "trustee-perf.json"), encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    if perf.get("source") == "BCT官網（bcthk.com）":
        perf["source"] = "发行人官网（BCT + 宏利）"

    ok_h = ok_p = fail = 0
    for fid, code, name in targets:
        d = fetch_one(code)
        if not d:
            print("  [!] %s %s 获取失败" % (code, name[:16]), flush=True)
            fail += 1
            time.sleep(0.6)
            continue
        # —— 持仓 / 组合分布 ——
        fb = d.get("fundHoldingBreakdowns") or {}
        top = (fb.get("top10Holdings") or {})
        alloc = (fb.get("portfolioAllocation") or {})
        asof = hkt_date(top.get("asOfDate") or alloc.get("asOfDate"))
        t10 = [{"name": str(x.get("name", "")), "weight": num(x.get("weight"))} for x in (top.get("data") or []) if x.get("name")]
        al = [{"label": str(x.get("name", "")), "weight": num(x.get("weight"))} for x in (alloc.get("data") or []) if x.get("name")]
        if t10 or al:
            hld["funds"][fid] = {"asOf": asof, "top10": t10, "alloc": al, "src": "manulife"}
            ok_h += 1
        # —— 官方回报（合并进 trustee-perf） ——
        cum = {p.get("period"): num(p.get("value")) for p in ((d.get("cumulativeReturns") or {}).get("periods") or [])}
        cal = {str(p.get("period")): num(p.get("value")) for p in ((d.get("calendarYearReturns") or {}).get("periods") or [])}
        if cum:
            perf["funds"][fid] = {
                "src": "manulife",
                "asOf": hkt_date((d.get("cumulativeReturns") or {}).get("asOfDate")),
                "ytd": cum.get("ytd"), "m6": cum.get("m6"), "y1": cum.get("y1"),
                "y3": cum.get("y3"), "y5": cum.get("y5"), "since": cum.get("si"),
                "cal": cal, "risk": num(d.get("riskRating")),
            }
            ok_p += 1
        time.sleep(0.7)
        if (ok_h + fail) % 10 == 0:
            print("  进度 %d/%d" % (ok_h + fail, len(targets)), flush=True)

    hld["updatedAt"] = int(time.time() * 1000)
    hld["count"] = len(hld["funds"])
    hld["note"] = hld.get("note") or "前十大持仓与组合分布：来自发行人官网基金详情页（季度更新，asOfDate 已转 HKT）"
    with open(os.path.join(DATA, "holdings.json"), "w", encoding="utf-8") as f:
        json.dump(hld, f, ensure_ascii=False, separators=(",", ":"))
    perf["updatedAt"] = int(time.time() * 1000)
    perf["count"] = len(perf["funds"])
    with open(os.path.join(DATA, "trustee-perf.json"), "w", encoding="utf-8") as f:
        json.dump(perf, f, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：持仓 %d 只（holdings 共 %d）· 官方回报 %d 只（trustee-perf 共 %d）· 失败 %d"
          % (ok_h, hld["count"], ok_p, perf["count"], fail), flush=True)


if __name__ == "__main__":
    main()
