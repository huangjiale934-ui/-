# -*- coding: utf-8 -*-
"""
BCT 系历史净值回填（v2 · 断点续传）—— 广州精研数据有限公司 · 香港强积金数据平台
==============================================================
数据源：BCT 官网基金资讯接口（可传历史日期，返回该日全计划净值）
  https://www.bcthk.com/bin/servlet/fundInformation?lang=zh&schemaInfoId=<计划>&date=YYYY-MM-DD
覆盖：6 个 BCT 计划共 116 条（BCT積金之選26 / 800系列28 / 策略計劃26 / 明智之選14 / 行業計劃12 / 易富之選10）
输出：
  data/hist/<基金id>.json（与宏利脚本同格式，合并写入）
  data/hist-index.json（合并更新，保留其它来源条目）
日期策略（**已精简**，一次请求返回全计划）：
  · 近 200 天：逐交易日（保证 1周/1月/近1年/YTD/回撤 精度）
  · 200 天～2.5 年：每周（周五）
  · 2.5 年～5.5 年：每月（月末工作日）
  ≈ 296 个日期 × 6 计划 ≈ 1776 请求
**限速与续传**：请求过快时 BCT 会把响应拖慢到 4-9s；脚本自适应退避（0.7s 起，
超过 3s 慢响应则加倍），并把原始结果**每个日期落盘一次**到 tmp/bct_raw.json——
中断后重跑自动跳过已完成日期（`--fresh` 可清缓存重来）。
用法：
  python fetch-bct-hist.py --dry         # 只做名称匹配检查
  python fetch-bct-hist.py               # 抓取（可随时中断，重跑续传）
  python fetch-bct-hist.py --assemble    # 只用缓存组装 data/hist（不再请求）
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
CACHE = os.path.join(BASE, "tmp", "bct_raw.json")

API = "https://www.bcthk.com/bin/servlet/fundInformation"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}
SRC_LABEL = "BCT官網（bcthk.com）"
RES_NOTE = "官方逐日净值（2016 年起全交易日回填）"

SCHEMES = {
    "pro-choice": "BCT積金之選",
    "series-800": "BCT強積金計劃800系列",
    "strategic-mpf": "BCT強積金策略計劃",
    "smart-plan": "BCT強積金—明智之選",
    "industry-choice": "BCT（強積金）行業計劃",
    "simple-plan": "BCT強積金—易富之選",
}


def norm(s):
    s = str(s or "")
    for ch in "（）()【】[]-–—－·,，.。":
        s = s.replace(ch, "")
    s = re.sub(r"\s+", "", s)
    s = s.replace("類單位", "").replace("單位類別", "").replace("單位", "")
    return s


def norm_unit(u):
    u = str(u or "").strip().upper()
    return "" if u in ("-", "—", "N/A") else u


def fetch_day(sid, date_str, retries=3):
    for attempt in range(retries):
        try:
            t0 = time.time()
            r = cffi.get(API, params={"lang": "zh", "schemaInfoId": sid, "date": date_str},
                         headers=UA, impersonate="chrome", timeout=45)
            return (r.json().get("data") or {}).get("fundInformationList") or [], time.time() - t0
        except Exception:  # noqa: BLE001
            if attempt < retries - 1:
                time.sleep(1.5 + attempt * 2)
    return None, 0


def gen_dates():
    today = dt.date.today()
    out = []
    recent_start = today - dt.timedelta(days=200)
    d = recent_start
    while d <= today:
        if d.weekday() < 5:
            out.append(d.isoformat())
        d += dt.timedelta(days=1)
    wk_end = today - dt.timedelta(days=int(365 * 2.5) + 30)
    d = recent_start
    while d >= wk_end:
        if d.weekday() == 4:
            out.append(d.isoformat())
        d -= dt.timedelta(days=1)
    y, m = wk_end.year, wk_end.month
    while (y, m) >= (2016, 1):
        last = dt.date(y, m, 1)
        nxt = (last + dt.timedelta(days=32)).replace(day=1)
        eom = nxt - dt.timedelta(days=1)
        while eom.weekday() >= 5:
            eom -= dt.timedelta(days=1)
        out.append(eom.isoformat())
        m -= 1
        if m == 0:
            y, m = y - 1, 12
    return sorted(set(out))


def load_cache():
    if os.path.exists(CACHE):
        try:
            return json.load(open(CACHE, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    return {"rows": {}, "done": []}


def save_cache(c):
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(c, fh, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, CACHE)


def build_pairs(funds):
    """名称配对（每计划取 2026-10-12 实时数据）→ (计划, code) -> fid"""
    ours = {}
    for x in funds:
        if x.get("scheme") in SCHEMES.values():
            ours.setdefault(x["scheme"], []).append(x)
    pairs = {}
    failed = []
    for sid, scheme in SCHEMES.items():
        lst, _ = fetch_day(sid, "2026-10-12")
        if lst is None:
            print("  [!] %s 无法获取（将在第二轮重试）" % scheme)
            failed.append((sid, scheme))
            continue
        _pair_scheme(ours, pairs, sid, scheme, lst)
        time.sleep(0.6)
    # 第二轮补漏（限速/瞬时失败时）
    for sid, scheme in failed:
        lst, _ = fetch_day(sid, "2026-10-12", retries=4)
        if lst is None:
            print("  [!] %s 仍无法获取，该计划本次跳过" % scheme)
            continue
        _pair_scheme(ours, pairs, sid, scheme, lst)
        time.sleep(1.5)
    return pairs


def _pair_scheme(ours, pairs, sid, scheme, lst):
    api = {}
    for row in lst:
        api[(norm(row.get("name")), norm_unit(row.get("unitClass")))] = row
    hit = miss = 0
    for x in ours.get(scheme, []):
        base = re.sub(r"\s*[-–—]\s*(?:單位類別|類單位|單位)?\s*[A-Za-z0-9]{1,2}\s*(?:類單位|單位類別|單位)?\s*$",
                      "", x["fund"]).strip()
        row = api.get((norm(base), norm_unit(x.get("unit"))))
        if not row:
            cand = [r for (n, u), r in api.items() if n == norm(base)]
            if len(cand) == 1:
                row = cand[0]
        if row:
            pairs[(sid, row.get("code", ""))] = x["id"]
            hit += 1
        else:
            miss += 1
            print("      未匹配: %s | unit=%s" % (x["fund"], x.get("unit", "")))
    print("   %s：%d 命中 / %d 未匹配" % (scheme.ljust(26), hit, miss))


def pct_num(v):
    try:
        return float(str(v).replace("%", "").replace(",", "").strip())
    except (TypeError, ValueError):
        return None


def fetch_perf():
    """抓 6 个计划的官方业绩快照（一次/计划，共 6 请求）→ data/trustee-perf.json
    口径（BCT 官网免责声明原文）：年初至今 / 1个月 / 3个月 / 1/3/5/10年 / 自成立
    = 截至「最近的可用月底」的**累積回報**（非年化）。"""
    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    pairs = build_pairs(funds)
    print("  配对 %d 只" % len(pairs), flush=True)
    today = dt.date.today().isoformat()
    out = {}
    for sid, scheme in SCHEMES.items():
        lst, _ = fetch_day(sid, today)
        if not lst:
            print("  [!] %s 业绩获取失败" % scheme)
            continue
        for row in lst:
            fid = pairs.get((sid, row.get("code")))
            if not fid:
                continue
            det = row.get("fundPerformanceDetail") or {}
            perf = det.get("fundPerformance") or {}
            caly = det.get("fundCalendarYears") or {}
            cal = {}
            for i in range(1, 6):
                y = caly.get("last%dCalyear" % i)
                v = pct_num(caly.get("last%dCalyearPerformance" % i))
                if y and v is not None:
                    cal[str(y)] = v
            risk = row.get("riskLevel") or {}
            out[str(fid)] = {
                "src": "bct",
                "asOf": perf.get("performanceDate") or "",
                "ytd": pct_num(perf.get("ytdPerformance")),
                "m1": pct_num(perf.get("lastMonthPerformance")),
                "m3": pct_num(perf.get("last3MonthPerformance")),
                "y1": pct_num(perf.get("lastYearPerformance")),
                "y3": pct_num(perf.get("last3YearPerformance")),
                "y5": pct_num(perf.get("last5YearPerformance")),
                "y10": pct_num(perf.get("last10YearPerformance")),
                "since": pct_num(perf.get("sinceLaunchPerformance")),
                "cal": cal,
                "risk": pct_num(risk.get("level")),
            }
        print("  %s：%d 只" % (scheme.ljust(26), len([1 for k in out])), flush=True)
        time.sleep(0.6)
    obj = {
        "updatedAt": int(time.time() * 1000),
        "source": "BCT官網（bcthk.com）",
        "note": "官網原文口徑：年初至今 / 1個月 / 3個月 / 1年 / 3年 / 5年 / 10年 / 自成立均為截至最近可用月底的累積回報（非年化）",
        "count": len(out),
        "funds": out,
    }
    with open(os.path.join(DATA, "trustee-perf.json"), "w", encoding="utf-8") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    print("  已写入 data/trustee-perf.json（%d 只）" % len(out), flush=True)


def main():
    dry = "--dry" in sys.argv
    assemble_only = "--assemble" in sys.argv
    perf_only = "--perf" in sys.argv
    if "--fresh" in sys.argv and os.path.exists(CACHE):
        os.remove(CACHE)
        print("已清除缓存", CACHE)

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]

    if perf_only:
        print("抓取 BCT 官方业绩快照…", flush=True)
        fetch_perf()
        return

    if assemble_only:
        pairs = None
    else:
        print("① 名称配对…", flush=True)
        pairs = build_pairs(funds)
        print("   配对 %d 只" % len(pairs), flush=True)
        if dry:
            print("（--dry 模式，不抓历史）")
            return
        # (sid, code) -> fid 直接用于行映射

    cache = load_cache()
    rows = cache["rows"]          # sid -> date -> {code: price}
    done = set(cache["done"])
    dates = gen_dates()
    todo = [d for d in dates if d not in done]
    todo.reverse()  # **最新优先**：BCT 接口在高频请求下会变慢，中断续传时优先保住近期数据
    if "--max-dates" in sys.argv:
        todo = todo[:int(sys.argv[sys.argv.index("--max-dates") + 1])]
    print("② 待抓 %d / %d 个日期（约 %d 请求，最新优先）" % (len(todo), len(dates), len(todo) * len(SCHEMES)), flush=True)

    sleep_s = 0.7
    for i, ds in enumerate(todo, 1):
        for sid in SCHEMES:
            lst, cost = fetch_day(sid, ds)
            if lst is None:
                print("   [!] %s @ %s 失败（跳过，可在重跑时补）" % (sid, ds), flush=True)
                continue
            bucket = rows.setdefault(sid, {})
            for row in lst:
                det = row.get("fundPerformanceDetail") or {}
                pd_ = det.get("priceDate") or ""
                try:
                    pv = float(det.get("price"))
                except (TypeError, ValueError):
                    continue
                if pv > 0 and pd_:
                    # 始终以「实际净值日期」为键（非交易日会回退到上一交易日，不能标成请求日）
                    bucket.setdefault(pd_, {})[row.get("code", "")] = pv
            # 自适应退避：慢响应加大间隔
            if cost > 3:
                sleep_s = min(4.0, sleep_s * 1.6)
            elif cost < 1.0:
                sleep_s = max(0.6, sleep_s * 0.9)
            time.sleep(sleep_s)
        done.add(ds)
        cache["done"] = sorted(done)
        save_cache(cache)
        if i % 5 == 0 or i == len(todo):
            print("   %4d/%d 日期完成 · 间隔 %.1fs · 缓存 %.1fMB" %
                  (i, len(todo), sleep_s, os.path.getsize(CACHE) / 1e6), flush=True)

    # 组装
    print("③ 组装 data/hist …", flush=True)
    if pairs is None:
        pairs = build_pairs(funds)
    series = {}
    for sid, dmap in rows.items():
        for d, codes in dmap.items():
            for code, pv in codes.items():
                fid = pairs.get((sid, code))
                if fid:
                    series.setdefault(fid, {})[d] = pv
    os.makedirs(HIST_DIR, exist_ok=True)
    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}
    saved = 0
    for fid, dmap in series.items():
        # 2026-10-22 修：与磁盘已有 hist 合并后再写。
        # 原实现只写「本次抓到的日期」，一旦 tmp 缓存被清（部署前清 tmp）或只补近端日期，
        # 就会把 2000 年以来的历史整段截断 —— 与永明当初的覆盖写是同一类问题。
        _hp = os.path.join(HIST_DIR, "%s.json" % fid)
        if os.path.exists(_hp):
            try:
                _old = json.load(open(_hp, encoding="utf-8"))
                for _d, _v in _old.get("series", []):
                    dmap.setdefault(_d, _v)
            except Exception:  # noqa: BLE001
                pass
        arr = sorted(dmap.items())
        if len(arr) < 20:
            continue
        x = next((y for y in funds if y["id"] == fid), None)
        if not x:
            continue
        code = ""
        for (sid, c), f2 in pairs.items():
            if f2 == fid:
                code = c
                break
        obj = {
            "id": str(fid), "code": code, "name": x["fund"], "unit": x.get("unit", ""),
            "scheme": x.get("scheme", ""), "src": SRC_LABEL, "res": RES_NOTE,
            "asOf": arr[-1][0], "last": arr[-1][1], "first": arr[0][0], "points": len(arr),
            "series": [[d, p] for d, p in arr],
        }
        with open(os.path.join(HIST_DIR, "%s.json" % fid), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        idx[str(fid)] = {
            "code": code, "src": "bct", "name": obj["name"], "unit": obj["unit"], "scheme": obj["scheme"],
            "asOf": obj["asOf"], "last": obj["last"], "first": obj["first"], "points": obj["points"],
        }
        saved += 1
    with open(INDEX, "w", encoding="utf-8") as fh:
        json.dump({"updatedAt": int(time.time() * 1000), "source": "各发行人官网（宏利 + BCT 系）",
                   "count": len(idx), "funds": idx}, fh, ensure_ascii=False, separators=(",", ":"))
    print("   完成：写入 %d 只 BCT 系历史；hist-index 共 %d 只" % (saved, len(idx)), flush=True)


if __name__ == "__main__":
    main()
