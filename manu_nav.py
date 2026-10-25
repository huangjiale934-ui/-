# -*- coding: utf-8 -*-
"""宏利净值直连 API 补抓（manu_nav.py）
=====================================
背景：宏利官网基金价格页是 SPA，无头 Chrome 有时拿不到数据表（HTML 里没有日期），
      导致 navbuild 解析 0 只、净值停在旧日期。改用官网 fundhistory API 直取最新一点。

用法：python manu_nav.py            # 补抓并把最新价写回 data/nav.json 的 Manu-* 条目
      python manu_nav.py --dry
"""
import datetime as dt
import json
import os
import sys

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
NAV = os.path.join(DATA, "nav.json")
IDX = os.path.join(DATA, "hist-index.json")

API = "https://www.manulife.com.hk/bin/funds/fundhistory"
H = {"Accept": "application/json",
     "Referer": "https://www.manulife.com.hk/zh-HK/personal/funds/manulife-mpf",
     "Origin": "https://www.manulife.com.hk"}


def fetch_latest(code, s):
    for attempt in range(3):
        try:
            r = s.get(API, params={"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"},
                      headers=H, timeout=45)
            ph = (r.json() or {}).get("priceHistory") or []
            if ph:
                last = ph[-1]
                d = (last.get("asOfDate") or "").strip()
                p = last.get("price")
                if d and p:
                    return d, float(p)
        except Exception:  # noqa: BLE001
            pass
    return None, None


def main():
    dry = "--dry" in sys.argv
    idx = json.load(open(IDX, encoding="utf-8"))["funds"]
    nav = json.load(open(NAV, encoding="utf-8"))
    items = nav.get("items") or []

    # 宏利基金的 code：hist-index 里 src=manulife 的条目带 code
    code_by_id = {}
    for fid, v in idx.items():
        if v.get("src") == "manulife" and v.get("code"):
            code_by_id[str(fid)] = v["code"]
    print("宏利代码 %d 只" % len(code_by_id))

    s = cffi.Session(impersonate="chrome")
    updated = 0
    newest = ""
    for it in items:
        if not str(it.get("srcKey") or it.get("key") or "").startswith("Manu"):
            continue
        # nav.json 的条目按基金名匹配我们的 id
        pass

    # 直接按 id 找 nav.json 条目（items 里没有 id 字段时用「计划+基金名」匹配 funds.json）
    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    by_key = {}
    for f in funds:
        if str(f.get("id")) in code_by_id:
            by_key[(f.get("scheme") or "") + "|" + (f.get("fundBase") or f.get("fund") or "")] = f
    for it in items:
        k = (it.get("scheme") or "") + "|" + (it.get("fund") or "")
        f = by_key.get(k)
        if not f:
            continue
        code = code_by_id[str(f["id"])]
        d, p = fetch_latest(code, s)
        if not d:
            continue
        if d > (it.get("asOf") or ""):
            if not dry:
                it["nav"] = p
                it["asOf"] = d
                it["price"] = p
            updated += 1
        if d > newest:
            newest = d

    print("更新 %d 条；最新日期 %s" % (updated, newest))
    if dry:
        return
    nav["updatedAt"] = int(dt.datetime.now().timestamp() * 1000)
    # 来源 asOf 同步
    for src in nav.get("sources") or []:
        if str(src.get("key", "")).startswith("Manu") and newest:
            src["asOf"] = newest
    json.dump(nav, open(NAV, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("已写入", NAV)


if __name__ == "__main__":
    main()
