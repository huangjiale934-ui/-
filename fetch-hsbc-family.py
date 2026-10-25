# -*- coding: utf-8 -*-
"""
HSBC 系历史净值（滙豐 + 恒生）—— 官方「基金价格下载」CSV
====================================================================
数据源：滙豐／恒生強積金官网「單位價格」工具背后的官方 API（rbwm-api.hsbc.com.hk）
  下载端点（全基金，窗口 ≤ 1 个月）：
    {proxy}/v1/download-funds?schemeCodes={code}&fundPricePeriodFrom=&fundPricePeriodTo=&language=zh_HK
  CSV 结构：第 1 行=日期（每日两列：買入價/賣出價）；第 2 行=表头；此后每行=一只基金。
  官方口径：買入價=賣出價=單位價格（本平台已发布净值与 2026-10-12 当日值逐只核对一致）。
覆盖：滙豐強積金智選計劃（HB，20 只，hk-hbap 代理）
      恒生強積金智選計劃（HS，20 只，hk-hase 代理）
输出：data/hist/<基金id>.json + 合并 data/hist-index.json
用法：
  python fetch-hsbc-family.py                 # 默认抓 2021-01-01 至今
  python fetch-hsbc-family.py --from 2023-01-01
"""
import csv
import datetime as dt
import io
import json
import os
import re
import sys
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
CLIENT_ID = "5eca677638ab454086052a18da4e2cb0"

PLATFORMS = [
    {
        "key": "hsbc", "src": "滙豐官網（rbwm-api）", "scheme": "滙豐強積金智選計劃",
        "proxy": "wpb-gpbw-mmw-hk-hbap-pa-p-wpp-mpf-market-data-prod-proxy", "code": "HB",
    },
    {
        "key": "hangseng", "src": "恒生官網（rbwm-api）", "scheme": "恒生強積金智選計劃",
        "proxy": "wpb-gpbw-mmw-hk-hase-pa-p-wpp-mpf-market-data-prod-proxy", "code": "HS",
    },
]
API = "https://rbwm-api.hsbc.com.hk/%s/v1/download-funds"


def norm(s):
    s = str(s or "")
    for ch in "（）()【】[]-–—－·,，.。 ":
        s = s.replace(ch, "")
    return s


def gen_windows(start_iso, days=28):
    d = dt.date.fromisoformat(start_iso)
    today = dt.date.today()
    out = []
    while d <= today:
        e = min(d + dt.timedelta(days=days - 1), today)
        out.append((d.isoformat(), e.isoformat()))
        d = e + dt.timedelta(days=1)
    return out


def fetch_csv(proxy, code, frm, to, retries=3):
    url = API % proxy
    for attempt in range(retries):
        try:
            r = cffi.get(url, params={
                "schemeCodes": code, "fundPricePeriodFrom": frm, "fundPricePeriodTo": to, "language": "zh_HK",
            }, headers={
                "client_id": CLIENT_ID, "x-hsbc-channel-id": "WEB",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            }, impersonate="chrome", timeout=60)
            if r.status_code == 200 and "基金名稱" in r.text[:4000]:
                return r.text
            if attempt < retries - 1:
                time.sleep(1.5 + attempt)
        except Exception:  # noqa: BLE001
            if attempt < retries - 1:
                time.sleep(1.5 + attempt)
    return None


def parse_csv(text, series):
    rows = list(csv.reader(io.StringIO(text)))
    if len(rows) < 3:
        return 0
    dates = rows[0]
    n = 0
    for row in rows[2:]:
        if not row or not row[0]:
            continue
        name = row[0].strip()
        dmap = series.setdefault(name, {})
        for i in range(1, min(len(dates), len(row))):
            ds = dates[i].strip()
            if not ds or not re.match(r"^\d{4}-\d{2}-\d{2}$", ds):
                continue
            try:
                v = float(row[i])
            except (TypeError, ValueError):
                continue
            if v > 0:
                dmap[ds] = v
        n += 1
    return n


def main():
    start = "2021-01-01"
    if "--from" in sys.argv:
        start = sys.argv[sys.argv.index("--from") + 1]
    # 2026-10-22：支持 --days（窗口天数，默认 28）与 --scheme（只跑某个计划）。
    # 28 天窗口跑 2004 年起要 298 个请求/计划，接口会限流到 2 分钟/次；
    # 改成 365 天窗口后只需 22 个请求，几分钟即可跑完。
    days = 28
    if "--days" in sys.argv:
        days = int(sys.argv[sys.argv.index("--days") + 1])
    only_scheme = ""
    if "--scheme" in sys.argv:
        only_scheme = sys.argv[sys.argv.index("--scheme") + 1]

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}

    total_ok = 0
    for plat in PLATFORMS:
        if only_scheme and plat["scheme"] != only_scheme:
            continue
        ours = [x for x in funds if x.get("scheme") == plat["scheme"]]
        by_name = {}
        for x in ours:
            by_name.setdefault(norm(x["fund"]), x)
        print("== %s（%d 只）==" % (plat["scheme"], len(ours)))
        windows = gen_windows(start, days)
        series = {}
        got = {}
        for k, (frm, to) in enumerate(windows, 1):
            text = fetch_csv(plat["proxy"], plat["code"], frm, to)
            if text is None:
                print("   [!] %s ~ %s 下载失败（跳过）" % (frm, to))
                continue
            cnt = parse_csv(text, series)
            got[(frm, to)] = cnt
            if k % 10 == 0 or k == len(windows):
                print("   %3d/%d 窗口 · 累计基金 %d 只" % (k, len(windows), len(series)))
            time.sleep(0.9)

        mapped = 0
        for name, dmap in series.items():
            x = by_name.get(norm(name))
            if not x:
                continue
            arr = sorted(dmap.items())
            if len(arr) < 5:   # 2026-10-22：近端增量（--from）只有几个点，原 60 的门槛会把增量全部丢弃；历史完整性由 tools/hist-merge-snap.js 的并集合并保证
                continue
            obj = {
                "id": str(x["id"]), "code": plat["code"], "name": x["fund"], "unit": x.get("unit", ""),
                "scheme": x.get("scheme", ""), "src": plat["src"],
                "note": "官網「單位價格」下載（買入價；與已發布淨值逐點一致）",
                "asOf": arr[-1][0], "last": arr[-1][1], "first": arr[0][0],
                "points": len(arr), "series": [[d, p] for d, p in arr],
            }
            with open(os.path.join(HIST_DIR, "%s.json" % x["id"]), "w", encoding="utf-8") as fh:
                json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
            idx[str(x["id"])] = {
                "code": plat["code"], "src": plat["key"], "name": x["fund"], "unit": x.get("unit", ""),
                "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                "first": obj["first"], "points": obj["points"],
            }
            mapped += 1
        total_ok += mapped
        print("   → 落盘 %d 只" % mapped)

    with open(INDEX, "w", encoding="utf-8") as fh:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系）",
                   "count": len(idx), "funds": idx}, fh, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：新增/更新 %d 只；hist-index 共 %d 只" % (total_ok, len(idx)))


if __name__ == "__main__":
    main()
