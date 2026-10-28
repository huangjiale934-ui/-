# -*- coding: utf-8 -*-
"""
永明（Sun Life 彩虹强积金计划）历史净值 —— 官网 webservice
====================================================================
数据源：https://www.sunlife.com.hk/webservice/getmpforsofunddata（POST JSON）
  {"domainAndUserName":"hkportal","sqlKey":"MPF_DAILYPRICE","sqlParams":["YYYY-MM-DD","MPF"]}
  → 当日全部基金 NAV（含 FUND_DESCRIPTION_ZH / FUND_CD / FUND_CLASS / INCEPTION_DT）
页面：/zh-hant/investments/mpf-orso-fund-prices-performance/mpf-fund-prices-performance.type-MPF/
输出：data/hist/<id>.json（src=sunlife）+ 合并 data/hist-index.json
用法：python fetch-sunlife-hist.py [--from 2024-01-04] [--dry]
"""
import datetime as dt
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
CACHE = os.path.join(BASE, "tmp", "sunlife_cache")
API = "https://www.sunlife.com.hk/webservice/getmpforsofunddata"
SRC = "永明官網（彩虹強積金計劃）"
H = {"Referer": "https://www.sunlife.com.hk/zh-hant/investments/mpf-orso-fund-prices-performance/mpf-fund-prices-performance.type-MPF/",
     "Content-Type": "application/json; charset=utf-8",
     "Accept": "application/json, text/plain, */*"}
CLASS_MAP = {"A": "A類", "B": "B類", "C": "C類", "D": "D類", "H": "H類", "T": "T類", "": ""}


def norm_class(s):
    s = str(s or "").strip()
    return s


def parse_vd(s):
    """官网 VALUATION_DT（'26/10/2026'）→ date。2026-10-28 修：不再用请求日当净值日。"""
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", str(s or "").strip())
    if not m:
        return None
    return dt.date(int(m.group(3)), int(m.group(2)), int(m.group(1)))


def main():
    start = dt.date(2021, 1, 4)
    if "--from" in sys.argv:
        y, m, d = sys.argv[sys.argv.index("--from") + 1].split("-")
        start = dt.date(int(y), int(m), int(d))
    dry = "--dry" in sys.argv
    os.makedirs(CACHE, exist_ok=True)

    s = cffi.Session(impersonate="chrome")
    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ours = {}
    for x in funds:
        if x.get("trustee") != "永明":
            continue
        m = re.match(r"^(.*?)\s*-\s*([A-Z])類$", x["fund"])
        base_nm = m.group(1) if m else x["fund"]
        cls = m.group(2) if m else ""
        ours[(base_nm, cls)] = x

    def q(d):
        key = os.path.join(CACHE, d.isoformat() + ".json")
        if os.path.exists(key):
            try:
                return json.load(open(key, encoding="utf-8"))
            except Exception:  # noqa: BLE001
                pass
        for i in range(3):
            try:
                r = s.post(API, headers=H, json={"domainAndUserName": "hkportal",
                                                 "sqlKey": "MPF_DAILYPRICE",
                                                 "sqlParams": [d.isoformat(), "MPF"]}, timeout=60)
                if r.status_code == 200:
                    j = r.json() or []
                    json.dump(j, open(key, "w", encoding="utf-8"))
                    return j
            except Exception:  # noqa: BLE001
                pass
            time.sleep(1.5 + i)
        return None

    # 先取最近一个工作日，建立 (中文名, 类别) → 我方 id 映射
    d0 = dt.date.today() - dt.timedelta(days=1)
    rows0 = None
    for back in range(8):
        rows0 = q(d0 - dt.timedelta(days=back))
        if rows0:
            d0 = d0 - dt.timedelta(days=back)
            break
    if not rows0:
        print("初始查询失败")
        return
    id_of = {}
    for row in rows0:
        nm = (row.get("FUND_DESCRIPTION_ZH") or "").strip()
        cls = norm_class(row.get("FUND_CLASS"))
        # 类别可能是 'A類' 或 'A'
        cm = re.match(r"([A-Z])類", cls)
        c = cm.group(1) if cm else (cls if cls in ("A", "B", "C", "D", "H", "T") else "")
        x = ours.get((nm, c)) or ours.get((nm, ""))
        if x:
            id_of[(nm, c)] = str(x["id"])
    print("映射 %d / %d 只" % (len(id_of), len(ours)), flush=True)

    # 按日抓取
    series = {}
    d = start
    end = dt.date.today()
    n = ok = 0
    while d <= end:
        if d.weekday() >= 5:
            d += dt.timedelta(days=1)
            continue
        n += 1
        rows = q(d)
        if rows:
            ok += 1
            for row in rows:
                nm = (row.get("FUND_DESCRIPTION_ZH") or "").strip()
                cls = norm_class(row.get("FUND_CLASS"))
                cm = re.match(r"([A-Z])類", cls)
                c = cm.group(1) if cm else (cls if cls in ("A", "B", "C", "D", "H", "T") else "")
                fid = id_of.get((nm, c)) or id_of.get((nm, ""))
                nav = row.get("NAV")
                # 2026-10-28 修：以官网返回的 VALUATION_DT 为准。
                # 当日净值未发布 / 公众假期时，接口会回传上一估值日的数据，
                # 旧逻辑用请求日 d 落库，导致「10-28 显示 10-26 的值」这类假日期。
                vd = parse_vd(row.get("VALUATION_DT")) or d
                if fid and nav is not None:
                    series.setdefault(fid, {})[vd.isoformat()] = float(nav)
        if dry and n >= 3:
            break
        if n % 60 == 0:
            print("  进度 %d 个工作日（有效 %d）" % (n, ok), flush=True)
        d += dt.timedelta(days=1)
        time.sleep(0.5)

    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}
    # 2026-10-22：此前是「覆盖写」，用 --from 做增量会把历史截断；改为与已有文件合并
    for (nm, c), fid in id_of.items():
        fp0 = os.path.join(HIST_DIR, fid + '.json')
        if not os.path.exists(fp0):
            continue
        try:
            old = json.load(open(fp0, encoding='utf-8')).get('series') or []
            m = series.setdefault(fid, {})
            for k, v in old:
                m.setdefault(k, v)
        except Exception:  # noqa: BLE001
            pass

    saved = 0
    for (nm, c), fid in id_of.items():
        arr = sorted((series.get(fid) or {}).items())
        if len(arr) < 5:   # 2026-10-22：放宽门槛
            continue
        x = next((t for t in funds if str(t["id"]) == fid), None)
        if not x:
            continue
        # 2026-10-28：日期改为取 VALUATION_DT 后，这里不再需要「去掉末尾等值点」的补丁
        # ——货币市场基金本来就常年同值，误删会丢真实点。历史已由 tools/rebuild-sunlife.py 重建。
        if not arr:
            continue
        obj = {"id": fid, "code": "", "name": x["fund"], "unit": x.get("unit", ""),
               "scheme": x.get("scheme", ""), "src": SRC,
               "note": "官網 webservice MPF_DAILYPRICE（逐日 NAV）",
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
    print("\n完成：工作日 %d（有效 %d）· 写入 %d 只（hist-index 共 %d）" % (n, ok, saved, len(idx)))


if __name__ == "__main__":
    main()
