# -*- coding: utf-8 -*-
"""
中银保诚（BOCPT）历史净值 —— 官网「基金价格查询」表单（AJAX）
====================================================================
数据源：https://www.bocpt.com/homepage/zh-hk/{my-choice-mpf|easy-choice-mpf}/fund-price-enquiry/
  · GET 页面取 __RequestVerificationToken（表单内）+ 会话 cookie
  · POST /homepage/umbraco/Surface/FundForm/FundPriceEnquiry
    字段：__RequestVerificationToken / FundCode(MYMP|ECMP) / StartDate(dd/mm/yyyy) / Lang(zh-HK)
    头：X-Requested-With: XMLHttpRequest（Unobtrusive AJAX）
  · 返回 JSON（部分为双重编码）：Table=[{price_date, price_exist}]、Table1=[{fund_code, fund_name, offer_price, bid_price}]
  · 须用 curl_cffi 浏览器指纹（裸 curl 会被 WAF 判 500）
输出：data/hist/<id>.json（src=bocpt）+ 合并 data/hist-index.json
用法：
  python fetch-bocpt-hist.py                # 2021-01 起全量（约 20 分钟/计划）
  python fetch-bocpt-hist.py --from 2024-01 # 指定起点
  python fetch-bocpt-hist.py --dry          # 只测 3 天
"""
import datetime as dt
import json
import os
import sys
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
CACHE = os.path.join(BASE, "tmp", "bocpt_cache")
POST = "https://www.bocpt.com/homepage/umbraco/Surface/FundForm/FundPriceEnquiry"
SRC = "中銀保誠官網（基金價格查詢）"
SCHEMES = {
    "MYMP": "https://www.bocpt.com/homepage/zh-hk/my-choice-mpf/fund-price-enquiry/",
    "ECMP": "https://www.bocpt.com/homepage/zh-hk/easy-choice-mpf/fund-price-enquiry/",
}


def parse_json_loose(t):
    j = json.loads(t)
    if isinstance(j, str):
        j = json.loads(j)
    return j


def query_date(s, url, code, d, retries=3):
    """查询某计划某日价格；返回 {code: (offer, bid)} 或 None（非交易日/失败）"""
    key = os.path.join(CACHE, code + "_" + d.strftime("%Y%m%d") + ".json")
    if os.path.exists(key):
        try:
            j = json.load(open(key, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            j = None
        if j is not None:
            return j
    for i in range(retries):
        try:
            r = s.post(POST, data={"__RequestVerificationToken": s.__tok, "FundCode": code,
                                   "StartDate": d.strftime("%d/%m/%Y"), "Lang": "zh-HK"},
                       headers={"Referer": url, "X-Requested-With": "XMLHttpRequest"}, timeout=60)
            if r.status_code != 200:
                time.sleep(1.5)
                continue
            j = parse_json_loose(r.text)
            t = (j.get("Table") or [{}])[0]
            if t.get("price_exist") != "Y":
                os.makedirs(CACHE, exist_ok=True)
                json.dump({}, open(key, "w", encoding="utf-8"))
                return {}
            t1 = j.get("Table1") or []
            if isinstance(t1, str):
                t1 = json.loads(t1)
            out = {}
            for f in t1:
                try:
                    out[f["fund_code"]] = (float(f["offer_price"]), float(f["bid_price"]))
                except (KeyError, TypeError, ValueError):
                    continue
            os.makedirs(CACHE, exist_ok=True)
            json.dump(out, open(key, "w", encoding="utf-8"))
            return out
        except Exception:  # noqa: BLE001
            time.sleep(1.5 + i)
    return None


def main():
    start = dt.date(2021, 1, 4)
    if "--from" in sys.argv:
        y, m, dd = sys.argv[sys.argv.index("--from") + 1].split("-")
        start = dt.date(int(y), int(m), int(dd))
    dry = "--dry" in sys.argv
    os.makedirs(CACHE, exist_ok=True)

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    # 我方基金 → (计划, 名称)
    ours = {}
    for x in funds:
        if x.get("trustee") == "中銀保誠":
            sch = "MYMP" if x.get("scheme") == "我的強積金計劃" else "ECMP"
            ours[(sch, x["fund"].strip())] = x

    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}

    # 名称 → fund_code 映射（用最近一个交易日）
    s = cffi.Session(impersonate="chrome")
    code_of = {}     # (sch, our_name) -> fund_code
    name_by_code = {}
    for sch, url in SCHEMES.items():
        r0 = s.get(url, timeout=60)
        import re
        m = re.search(r'<form action="/homepage/umbraco/Surface/FundForm/FundPriceEnquiry"[\s\S]*?</form>', r0.text)
        tok = re.search(r'name="__RequestVerificationToken"[^>]*value="([^"]+)"', m.group(0)).group(1)
        s.__tok = tok
        d0 = dt.date.today() - dt.timedelta(days=1)
        got = None
        for back in range(8):
            got = query_date(s, url, sch, d0 - dt.timedelta(days=back))
            if got:
                break
        if not got:
            print("  [!] %s 初始查询失败" % sch)
            continue
        # 反查名称：用 API 名称匹配（最近交易日的名称不在缓存里，重新拉一次拿名称）
        r = s.post(POST, data={"__RequestVerificationToken": tok, "FundCode": sch,
                               "StartDate": (d0 - dt.timedelta(days=back)).strftime("%d/%m/%Y"), "Lang": "zh-HK"},
                   headers={"Referer": url, "X-Requested-With": "XMLHttpRequest"}, timeout=60)
        j = parse_json_loose(r.text)
        t1 = j.get("Table1") or []
        if isinstance(t1, str):
            t1 = json.loads(t1)
        for f in t1:
            nm = (f.get("fund_name") or "").strip()
            name_by_code[(sch, nm)] = f.get("fund_code")
        for (sch2, nm), x in ours.items():
            if sch2 != sch:
                continue
            fc = name_by_code.get((sch, nm))
            if fc:
                code_of[(sch, nm)] = fc
            else:
                print("  [!] %s %s 未匹配到基金代码" % (sch, nm))
        print("%s：匹配 %d 只基金" % (sch, sum(1 for k in code_of if k[0] == sch)), flush=True)

    # 按日抓取
    series = {}   # (sch, code) -> {date: price}
    d = start
    end = dt.date.today()
    n_days = ok_days = 0
    while d <= end:
        if d.weekday() >= 5:
            d += dt.timedelta(days=1)
            continue
        n_days += 1
        for sch, url in SCHEMES.items():
            if not any(k[0] == sch for k in code_of):
                continue
            if not hasattr(s, "__tok") or sch not in getattr(s, "_toks", {}):
                pass
            got = query_date(s, url, sch, d)
            if got is None:
                print("  [!] %s %s 查询失败" % (sch, d), flush=True)
                continue
            if got:
                ok_days += 1
                for fc, (offer, bid) in got.items():
                    series.setdefault((sch, fc), {})[d.isoformat()] = bid
        if dry and n_days >= 3:
            break
        if n_days % 40 == 0:
            print("  进度：%d 个工作日（有效 %d）" % (n_days, ok_days), flush=True)
        d += dt.timedelta(days=1)
        time.sleep(0.8)

    # 写文件
    saved = 0
    for (sch, nm), x in ours.items():
        fc = code_of.get((sch, nm))
        if not fc:
            continue
        arr = sorted((series.get((sch, fc)) or {}).items())
        if len(arr) < 5:   # 2026-10-22：同上，近端增量不再被门槛丢弃
            continue
        fid = str(x["id"])
        obj = {"id": fid, "code": fc, "name": x["fund"], "unit": x.get("unit", ""),
               "scheme": x.get("scheme", ""), "src": SRC,
               "note": "官網基金價格查詢（賣出價，逐日）",
               "asOf": arr[-1][0], "last": arr[-1][1], "first": arr[0][0],
               "points": len(arr), "series": [[k, v] for k, v in arr]}
        with open(os.path.join(HIST_DIR, fid + ".json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        idx[fid] = {"code": fc, "src": "bocpt", "name": obj["name"], "unit": obj["unit"],
                    "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                    "first": obj["first"], "points": obj["points"]}
        saved += 1
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系 + 中银保诚）",
                   "count": len(idx), "funds": idx}, f, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：工作日 %d（有效 %d）· 写入 %d 只（hist-index 共 %d）" % (n_days, ok_days, saved, len(idx)))


if __name__ == "__main__":
    main()
