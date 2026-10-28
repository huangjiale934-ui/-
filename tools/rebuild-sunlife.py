# -*- coding: utf-8 -*-
"""
永明（Sun Life）历史净值全量重建 —— 2026-10-28
================================================================
背景：fetch-sunlife-hist.py 历史上用「请求日期」当净值日，而官网接口对
      「当日净值尚未发布 / 公众假期」会返回上一估值日的数据（VALUATION_DT）。
      结果：序列里混入大量假日期（例：2026-10-26 实际是 10-23 的值、
      10-27/10-28 实际是 10-23/10-26 的值），并让 navAsOf 冲在所有人前面。

修法：以接口返回的 VALUATION_DT 为准（真估值日），逐个工作日回放到今天，
      同一估值日只保留一条。缓存 tmp/sunlife_cache/<请求日>.json 复用，
      缺失的并发补抓（串行太慢，单日 1–3 秒，全量要三小时）。

用法：python tools/rebuild-sunlife.py [--from 2015-01-05] [--dry] [--workers 6]
"""
import concurrent.futures as cf
import datetime as dt
import json
import os
import re
import sys
import threading
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
CACHE = os.path.join(BASE, "tmp", "sunlife_cache")
API = "https://www.sunlife.com.hk/webservice/getmpforsofunddata"
SRC = "永明官網（彩虹強積金計劃）"
H = {
    "Referer": "https://www.sunlife.com.hk/zh-hant/investments/mpf-orso-fund-prices-performance/mpf-fund-prices-performance.type-MPF/",
    "Content-Type": "application/json; charset=utf-8",
    "Accept": "application/json, text/plain, */*",
}
_tl = threading.local()


def sess():
    s = getattr(_tl, "s", None)
    if s is None:
        s = cffi.Session(impersonate="chrome")
        _tl.s = s
    return s


def parse_vd(s):
    """'26/10/2026' -> date(2026,10,26)"""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", str(s or "").strip())
    if not m:
        return None
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))


def cls_of(v):
    v = str(v or "").strip()
    m = re.match(r"([A-Z])類", v)
    if m:
        return m.group(1)
    return v if v in ("A", "B", "C", "D", "H", "T") else ""


def cache_path(d):
    return os.path.join(CACHE, d.isoformat() + ".json")


def fetch_one(d):
    """抓单日并落缓存；返回 ok/cached/fail"""
    key = cache_path(d)
    if os.path.exists(key):
        return "cached"
    for i in range(4):
        try:
            r = sess().post(API, headers=H, json={"domainAndUserName": "hkportal",
                                                 "sqlKey": "MPF_DAILYPRICE",
                                                 "sqlParams": [d.isoformat(), "MPF"]}, timeout=60)
            if r.status_code == 200:
                j = r.json() or []
                with open(key, "w", encoding="utf-8") as f:
                    json.dump(j, f)
                return "ok"
            if r.status_code in (429, 500, 502, 503, 504):
                time.sleep(2 + i * 2)
                continue
            return "fail:%d" % r.status_code
        except Exception:  # noqa: BLE001
            time.sleep(1 + i)
    return "fail"


def main():
    start = dt.date(2015, 1, 5)
    if "--from" in sys.argv:
        y, m, d = sys.argv[sys.argv.index("--from") + 1].split("-")
        start = dt.date(int(y), int(m), int(d))
    dry = "--dry" in sys.argv
    workers = 6
    if "--workers" in sys.argv:
        workers = int(sys.argv[sys.argv.index("--workers") + 1])
    os.makedirs(CACHE, exist_ok=True)

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ours = {}
    for x in funds:
        if x.get("trustee") != "永明":
            continue
        m = re.match(r"^(.*?)\s*-\s*([A-Z])類$", x["fund"])
        base_nm = m.group(1) if m else x["fund"]
        cls = m.group(2) if m else ""
        ours[(base_nm, cls)] = x

    today = dt.date.today()
    days = []
    d = start
    while d <= today:
        if d.weekday() < 5:
            days.append(d)
        d += dt.timedelta(days=1)

    missing = [x for x in days if not os.path.exists(cache_path(x))]
    print("区间 %s → %s：工作日 %d，已有缓存 %d，待抓 %d（%d 并发）"
          % (start, today, len(days), len(days) - len(missing), len(missing), workers), flush=True)
    if missing:
        t0 = time.time()
        done = 0
        failed = 0
        with cf.ThreadPoolExecutor(max_workers=workers) as ex:
            for res in ex.map(fetch_one, missing):
                done += 1
                if res.startswith("fail"):
                    failed += 1
                if done % 200 == 0:
                    print("  补抓 %d/%d（失败 %d，%.0fs）" % (done, len(missing), failed, time.time() - t0), flush=True)
        print("补抓完成：%d 天，失败 %d，用时 %.0fs" % (len(missing), failed, time.time() - t0), flush=True)

    # 建立 (中文名, 类别) → 我方 id 映射（用最近有数据的一天）
    rows0 = None
    for back in range(10):
        p = cache_path(today - dt.timedelta(days=back))
        if os.path.exists(p):
            rows0 = json.load(open(p, encoding="utf-8"))
            if rows0:
                break
    if not rows0:
        print("初始查询失败，退出")
        return 1
    id_of = {}
    for row in rows0:
        nm = (row.get("FUND_DESCRIPTION_ZH") or "").strip()
        c = cls_of(row.get("FUND_CLASS"))
        x = ours.get((nm, c)) or ours.get((nm, ""))
        if x:
            id_of[(nm, c)] = str(x["id"])
    print("映射 %d / %d 只" % (len(id_of), len(ours)), flush=True)

    series = {}
    for d in days:
        p = cache_path(d)
        if not os.path.exists(p):
            continue
        try:
            rows = json.load(open(p, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if not rows:
            continue
        for row in rows:
            nm = (row.get("FUND_DESCRIPTION_ZH") or "").strip()
            c = cls_of(row.get("FUND_CLASS"))
            fid = id_of.get((nm, c)) or id_of.get((nm, ""))
            nav = row.get("NAV")
            vd = parse_vd(row.get("VALUATION_DT")) or d
            if fid and nav is not None:
                series.setdefault(fid, {})[vd.isoformat()] = float(nav)

    if dry:
        for (nm, c), fid in list(id_of.items())[:3]:
            arr = sorted((series.get(fid) or {}).items())
            print("  %s %s 点 %d 末 %s" % (fid, nm, len(arr), arr[-1] if arr else "-"))
        print("（--dry：不写盘）")
        return 0

    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}

    saved = 0
    for (nm, c), fid in id_of.items():
        arr = sorted((series.get(fid) or {}).items())
        if len(arr) < 30:
            continue
        x = next((t for t in funds if str(t["id"]) == fid), None)
        if not x:
            continue
        obj = {"id": fid, "code": "", "name": x["fund"], "unit": x.get("unit", ""),
               "scheme": x.get("scheme", ""), "src": SRC,
               "note": "官網 webservice MPF_DAILYPRICE（以 VALUATION_DT 为估值日）",
               "asOf": arr[-1][0], "last": arr[-1][1], "first": arr[0][0],
               "points": len(arr), "series": [[k, v] for k, v in arr]}
        with open(os.path.join(HIST_DIR, fid + ".json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        idx[fid] = {"code": "", "src": "sunlife", "name": obj["name"], "unit": obj["unit"],
                    "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                    "first": obj["first"], "points": obj["points"]}
        saved += 1

    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系 + 中银保诚 + 中国人寿 + 永明）",
                   "count": len(idx), "funds": idx}, f, ensure_ascii=False, separators=(",", ":"))
    print("写入 %d 只，hist-index 共 %d" % (saved, len(idx)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
