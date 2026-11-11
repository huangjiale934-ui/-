# -*- coding: utf-8 -*-
"""yahoo-map-build.py —— 建立「基金 → 雅虎(晨星)代碼」映射，並算出尺度係數

為什麼需要：Yahoo 的香港基金代碼是晨星 0P… 編號，官方網站/積金局都沒有 ISIN 或對照表，
只能靠名稱匹配。匹配後必須用歷史淨值驗證「同一隻基金、同一個單位類別」——
實測同一隻基金的不同單位類別淨值可以差 15 倍（宏利北美股票 575.88 vs 37.46），
所以每個映射都存一個 ratio = 我們NAV / 雅虎收盤，並記錄逐日最大偏差。

輸出 data/yahoo-map.json：
  {"updatedAt":..., "funds": {"<id>": {"ticker","ratio","samples","maxDev","src"}}}

用法：python tools/yahoo-map-build.py [--config <path>]
"""
import argparse
import datetime
import json
import os
import re
import statistics
import sys

from curl_cffi import requests as cffi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "yahoo-map.json")
CACHE = os.path.join(ROOT, "tmp", "yahoo-cache.json")


try:                                    # 繁简统一（參考站部分名稱是簡體）
    from opencc import OpenCC
    _T2S = OpenCC("t2s")
except Exception:
    _T2S = None


def norm(s):
    s = str(s or "")
    if _T2S:
        s = _T2S.convert(s)
    for ch in "（）()【】[]-–—－·,，.。 /":
        s = s.replace(ch, "")
    return s.strip()


def yahoo_series(ticker, proxies):
    r = cffi.get("https://query1.finance.yahoo.com/v8/finance/chart/" + ticker,
                 params={"range": "1y", "interval": "1d"}, impersonate="chrome",
                 proxies=proxies, timeout=40)
    d = r.json()["chart"]["result"][0]
    ts = d.get("timestamp") or []
    cl = (d["indicators"]["quote"][0].get("close") or [])
    out = {}
    for t, c in zip(ts, cl):
        if c is None:
            continue
        day = datetime.datetime.fromtimestamp(t, datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d")
        out[day] = round(float(c), 6)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--config", default=os.path.join(ROOT, "..", "tmp", "ref-dashboard",
                                                     "mpf-analysis-dashboard-main", "config.py"))
    a = ap.parse_args()
    if not os.path.exists(a.config):
        print("找不到參考 config.py，無法建立映射（此檔只作一次性來源）")
        return 1

    import importlib.util
    spec = importlib.util.spec_from_file_location("cfg", os.path.abspath(a.config))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    # 參考站把基金分在 FUNDS（宏利）／BCT_FUNDS／AIA_FUNDS 三個字典裡，全部合併
    ref = {}
    for attr in ("FUNDS", "BCT_FUNDS", "AIA_FUNDS"):
        d = getattr(m, attr, None)
        if isinstance(d, dict):
            ref.update(d)

    funds = json.load(open(os.path.join(ROOT, "data", "funds.json"), encoding="utf-8"))["funds"]
    by_name = {}
    for f in funds:
        by_name.setdefault(norm(f.get("fundBase") or f.get("fund")), f)

    try:
        cache = json.load(open(CACHE, encoding="utf-8"))
    except Exception:
        cache = {}
    proxies = {"http": "http://127.0.0.1:7877", "https": "http://127.0.0.1:7877"}

    out = {}
    for k, v in ref.items():
        ticker = v.get("yahoo_fund")
        name = v.get("name_zh") or v.get("name") or ""
        if not ticker:
            continue
        f = by_name.get(norm(name))
        if not f:
            # 模糊：我方名稱包含參考名稱或反之
            cand = None
            for n, x in by_name.items():
                if n and (n == norm(name) or norm(name) in n or n in norm(name)):
                    cand = x
                    break
            f = cand
        if not f:
            print("SKIP 找不到對應基金：%s" % name)
            continue
        try:
            ser = cache.get(ticker)
            if not ser:
                ser = yahoo_series(ticker, proxies)
                cache[ticker] = ser
        except Exception as e:
            print("ERR  %-22s %s %s" % (name[:20], ticker, str(e)[:40]))
            continue
        try:
            hist = json.load(open(os.path.join(ROOT, "data", "hist", str(f["id"]) + ".json"), encoding="utf-8"))
        except Exception:
            print("SKIP 无历史：%s" % name)
            continue
        ours = dict((d, p) for d, p in hist.get("series", []))
        common = sorted(set(ours) & set(ser))
        if len(common) < 20:
            print("SKIP 重叠仅 %d 天：%s" % (len(common), name))
            continue
        ratios = [ours[d] / ser[d] for d in common if ser[d]]
        med = statistics.median(ratios)
        maxdev = max(abs(r / med - 1) for r in ratios)
        ok = maxdev <= 0.02
        print("%-24s %-16s 重叠%4d 比值%.4f 最大偏差%.2f%% %s"
              % (name[:24], ticker, len(common), med, maxdev * 100, "OK" if ok else "× 丢弃"))
        if ok:
            out[str(f["id"])] = {"ticker": ticker, "ratio": round(med, 6),
                                 "samples": len(common), "maxDev": round(maxdev, 5),
                                 "name": f.get("fundBase") or f.get("fund")}

    json.dump({"updatedAt": int(datetime.datetime.now().timestamp() * 1000), "funds": out},
              open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    print("已寫入 data/yahoo-map.json：%d 只（來源 %d 隻）" % (len(out), len(ref)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
