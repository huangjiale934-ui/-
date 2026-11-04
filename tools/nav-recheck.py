#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""最近 N 个交易日净值复核（全发行人，2026-11-04 第三十六轮）
====================================================================
背景：源站偶尔给错价（2026-10-30 BCT 曾把 23.3134 报成 24.2958，+4.2%，次日回吐）。
      只靠人工发现太被动 —— 这里每天对「最近 5 个交易日」逐只重抓一次，
      与库内数值比对：不一致就改正、写日志，并在页脚口径说明里留痕。

覆盖（按发行人接口形态实现适配器）：
  bct         BCT 6 个计划 × N 天（批量，一次拿全计划当日净值）
  bea         東亞 3 个计划（GetMPFData 直接返回全量逐日序列）
  manulife    宏利（fundhistory，逐只，多线程）
  fidelity    富達（NavChartData，逐只）
  aia         友邦（getFundDetails，逐只）
  chinalife   中國人壽（getFundPriceDataByDate，逐只）
  yflife      萬通（fundPriceDetail，逐只）
  haitong     海通（PerformanceChart，逐只）
未覆盖（接口需登录 / 人工下载 / 本身是转载）：
  bocpt（需 __RequestVerificationToken 会话）、hsbc / hangseng（CSV 下载接口）、
  sunlife（hist-index 无代码）、shkp / amtd（PDF）、etnet（转载）、bocom（源本身滞后）
  这些在下一次「全量历史抓取」里仍会被重新拉取，只是不在每日 5 日复核范围内。

用法：
  python tools/nav-recheck.py                 # 只比对，写报告，不改数据
  python tools/nav-recheck.py --apply         # 比对 + 修正 data/hist/*.json
  python tools/nav-recheck.py --days=5        # 回看天数（默认 5 个自然日窗口）
  python tools/nav-recheck.py --only=bea,bct  # 只跑指定来源
  python tools/nav-recheck.py --workers=8     # 逐只抓取的并发数（默认 6）
"""
import datetime as dt
import io
import json
import os
import re
import sys
import time
from concurrent.futures import ThreadPoolExecutor

try:
    from curl_cffi import requests as cffi
except Exception as e:  # noqa: BLE001
    print("需要 curl_cffi：", e)
    sys.exit(1)

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
HIST = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
OUT = os.path.join(DATA, "nav-recheck.json")
LOG = os.path.join(DATA, "nav-recheck.log")

ARGS = sys.argv[1:]
APPLY = "--apply" in ARGS
DAYS = int(next((a.split("=")[1] for a in ARGS if a.startswith("--days=")), 5))
WORKERS = int(next((a.split("=")[1] for a in ARGS if a.startswith("--workers=")), 6))
ONLY = next((a.split("=")[1].split(",") for a in ARGS if a.startswith("--only=")), None)
TOL = 2e-3          # 相对偏差阈值 0.2%（同 bct-refetch-recent 的 0.0002 * max(1,|px|)）
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}

idx = json.load(io.open(INDEX, encoding="utf-8"))["funds"]
FUNDS = json.load(io.open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
by_id = {str(x["id"]): x for x in FUNDS}

TODAY = dt.date.today()
WINDOW = [(TODAY - dt.timedelta(days=i)).isoformat() for i in range(DAYS, -1, -1)]
WINDOW_SET = set(WINDOW)


def pick(*prefixes):
    out = {}
    for fid, v in idx.items():
        s = str(v.get("src") or "").lower()
        if any(s.startswith(p) for p in prefixes):
            out[fid] = v
    return out


def load_hist(fid):
    p = os.path.join(HIST, fid + ".json")
    if not os.path.exists(p):
        return None, p
    return json.load(io.open(p, encoding="utf-8")), p


def local_recent(fid):
    obj, _ = load_hist(fid)
    if not obj:
        return {}
    return {d: float(v) for d, v in (obj.get("series") or []) if d in WINDOW_SET}


def per_fund(metas, worker):
    """逐只并发抓取；每个线程自建 session（requests.Session 非线程安全）"""
    out = {}

    def run(item):
        fid, v = item
        try:
            sess = cffi.Session(impersonate="chrome")
            return worker(sess, fid, v) or []
        except Exception:  # noqa: BLE001
            return []

    with ThreadPoolExecutor(max_workers=max(1, WORKERS)) as ex:
        for rows in ex.map(run, list(metas.items())):
            for fid, d, nav in rows:
                out[(fid, d)] = nav
    return out


# ---------------------------------------------------------------- adapters
def fetch_bct(sess):
    api = "https://www.bcthk.com/bin/servlet/fundInformation"
    plans = ["pro-choice", "series-800", "strategic-mpf", "smart-plan", "industry-choice", "simple-plan"]
    key2fid = {}
    for fid, v in pick("bct").items():
        key2fid[(v.get("code") or "") + "-" + (v.get("unit") or "")] = fid
    out = {}
    for plan in plans:
        for d in WINDOW:
            try:
                r = sess.get(api, params={"lang": "zh", "schemaInfoId": plan, "date": d},
                             headers=UA, impersonate="chrome", timeout=45)
                lst = ((r.json().get("data") or {}).get("fundInformationList") or [])
            except Exception:  # noqa: BLE001
                continue
            for row in lst:
                fpd = row.get("fundPerformanceDetail") or {}
                if fpd.get("priceDate") != d:
                    continue
                fid = key2fid.get((row.get("code") or "") + "-" + (row.get("unitClass") or ""))
                if not fid:
                    continue
                try:
                    out[(fid, d)] = round(float(fpd.get("price")), 4)
                except (TypeError, ValueError):
                    pass
    return out


def fetch_bea(sess):
    api = "https://www.hkbea.com/GetMPFData"
    code2fid = {(v.get("code") or ""): fid for fid, v in pick("bea").items()}
    out = {}
    for plan in ("0", "1", "2"):
        try:
            r = sess.post(api, data={"id": plan}, headers=UA, impersonate="chrome", timeout=90)
            j = r.json()
        except Exception:  # noqa: BLE001
            continue
        for group in j.values():
            if not isinstance(group, dict):
                continue
            for code, pts in group.items():
                fid = code2fid.get(code)
                if not fid or not isinstance(pts, list):
                    continue
                for p in pts:
                    try:
                        d = dt.datetime.fromtimestamp(p["x"] / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")
                    except Exception:  # noqa: BLE001
                        continue
                    if d in WINDOW_SET:
                        try:
                            out[(fid, d)] = round(float(p["y"]), 4)
                        except (TypeError, ValueError):
                            pass
    return out


def fetch_manulife(sess):
    api = "https://www.manulife.com.hk/bin/funds/fundhistory"
    H = {"Accept": "application/json",
         "Referer": "https://www.manulife.com.hk/zh-HK/personal/funds/manulife-mpf",
         "Origin": "https://www.manulife.com.hk"}

    def one(s, fid, v):
        code = v.get("code")
        if not code:
            return []
        r = s.get(api, params={"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"},
                  headers=H, impersonate="chrome", timeout=25)
        rows = []
        for it in (r.json().get("priceHistory") or []):
            d = (it.get("asOfDate") or "").strip()
            if d in WINDOW_SET:
                try:
                    rows.append((fid, d, round(float(it.get("price")), 4)))
                except (TypeError, ValueError):
                    pass
        return rows
    return per_fund(pick("manulife"), one)


def fetch_fidelity(sess):
    q = "countries=hk&country=hk&languages=zh%2Cen&language=zh&channels=ce.private-investor&channel=ce.private-investor"

    def one(s, fid, v):
        code = v.get("code")
        if not code:
            return []
        r = s.get("https://www.fidelity.com.hk/api/ce/fdh/NavChartData.json?id=%s&%s" % (code, q),
                  headers={"Accept": "application/json, text/plain, */*",
                           "Referer": "https://www.fidelity.com.hk/zh/funds/factsheet/%s/" % code},
                  impersonate="chrome", timeout=25)
        rows = []
        for ser in (r.json().get("series") or []):
            for ms, nav in (ser.get("data") or []):
                try:
                    d = dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone(dt.timedelta(hours=8))).strftime("%Y-%m-%d")
                except Exception:  # noqa: BLE001
                    continue
                if d in WINDOW_SET:
                    rows.append((fid, d, round(float(nav), 4)))
        return rows
    return per_fund(pick("fidelity"), one)


def fetch_aia(sess):
    H = {"Accept": "application/json, text/plain, */*",
         "Referer": "https://www.aia.com.hk/zh-hk/products/mpf/list"}

    def one(s, fid, v):
        code = v.get("code")
        if not code:
            return []
        r = s.get("https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundDetails/" + code,
                  headers=H, impersonate="chrome", timeout=25)
        rows = []
        for p in (r.json().get("priceDetails") or []):
            d = p.get("pdate") or ""
            if len(d) == 8:
                iso = "%s-%s-%s" % (d[:4], d[4:6], d[6:8])
                if iso in WINDOW_SET:
                    try:
                        rows.append((fid, iso, round(float(p.get("price")), 4)))
                    except (TypeError, ValueError):
                        pass
        return rows
    return per_fund(pick("aia"), one)


def fetch_chinalife(sess):
    api = "https://onepartner.chinalife.com.hk/prod-api/fundInformation/"
    H = {"Accept": "application/json, text/plain, */*",
         "Referer": "https://trustee.chinalife.com.hk/mpf/dailyPrices?request_locale=zh_TW"}

    def one(s, fid, v):
        code = v.get("code")
        if not code:
            return []
        r = s.get(api + "getFundPriceDataByDate", params={"fundCd": code}, headers=H,
                  impersonate="chrome", timeout=40)
        rows = []
        for row in (r.json().get("data") or []):
            # 中國人壽字段：effDate + offerPrice（認購價），与历史脚本取值一致
            d = str(row.get("effDate") or row.get("priceDate") or "")[:10]
            nav = row.get("offerPrice")
            if nav is None:
                nav = row.get("bidPrice")
            if d in WINDOW_SET and nav is not None:
                try:
                    rows.append((fid, d, round(float(nav), 4)))
                except (TypeError, ValueError):
                    pass
        return rows
    return per_fund(pick("chinalife"), one)


def fetch_yflife(sess):
    api = "https://www.yflife.com/aisite-applyapi/mo/moCompanyFund/"
    H = {"Content-Type": "application/json", "Accept": "application/json",
         "Referer": "https://www.yflife.com/sc/product/mpf-hongkong/fund-price-history/",
         "Origin": "https://www.yflife.com"}
    cmap_path = os.path.join(BASE, "tools", "yflife-code-map.json")
    cmap = json.load(io.open(cmap_path, encoding="utf-8")) if os.path.exists(cmap_path) else {}

    def one(s, fid, v):
        code = cmap.get(fid)
        if not code:
            return []
        r = s.post(api + "fundPriceDetail",
                   json={"fundCode": code, "queryType": "TIM",
                         "startDate": WINDOW[0], "endDate": WINDOW[-1]},
                   headers=H, impersonate="chrome", timeout=40)
        rows = []
        for row in (r.json().get("data") or []):
            raw = (row.get("price_date") or "").strip()
            m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", raw)
            if not m:
                continue
            iso = "%s-%02d-%02d" % (m.group(3), int(m.group(1)), int(m.group(2)))
            if iso in WINDOW_SET and row.get("unit_price") not in (None, ""):
                try:
                    rows.append((fid, iso, round(float(row["unit_price"]), 4)))
                except (TypeError, ValueError):
                    pass
        return rows
    return per_fund(pick("yflife"), one)


def fetch_haitong(sess):
    seg2core = {
        "Haitong_Age_65_Plus_Fund": "65歲後", "Haitong_Asia_Pacific_Fund": "亞太",
        "Haitong_Core_Accumulation_Fund": "核心累積", "Haitong_Global_Diversification_Fund": "環球分散",
        "Haitong_HongKong_SAR_Fund": "香港特區", "Haitong_Korea_Fund": "韓國",
        "Haitong_MPF_Conservative_Fund": "強積金保守",
    }

    def one(s, fid, v):
        code = v.get("code") or ""
        seg = next((x for x in seg2core if code.startswith(x)), None)
        if not seg:
            return []
        s.get("https://gthtam.com.hk/mpf/zh-cht", headers=UA, impersonate="chrome", timeout=30)
        s.cookies.set("mpf_disclaimer_popup", "yes", domain="gthtam.com.hk")
        s.cookies.set("Lang4hti_asm", "zh-CHT", domain="gthtam.com.hk")
        cls = "4" if (v.get("unit") or "") == "T" else "1"
        r = s.post("https://gthtam.com.hk/mpf/zh-CHT/MPF/PerformanceChart/%s?selectedClass=%s&dfrom=&dto=" % (seg, cls),
                   headers=UA, impersonate="chrome", timeout=40)
        j = r.json()
        labels = j[0] if isinstance(j, list) and j else []
        vals = j[1] if isinstance(j, list) and len(j) > 1 else []
        rows = []
        for lab, val in zip(labels, vals):
            m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", lab or "")
            if not m:
                continue
            iso = "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
            if iso in WINDOW_SET:
                try:
                    rows.append((fid, iso, round(float(val), 4)))
                except (TypeError, ValueError):
                    pass
        return rows
    return per_fund(pick("haitong"), one)


ADAPTERS = [
    ("bct", fetch_bct),
    ("bea", fetch_bea),
    ("manulife", fetch_manulife),
    ("fidelity", fetch_fidelity),
    ("aia", fetch_aia),
    ("chinalife", fetch_chinalife),
    ("yflife", fetch_yflife),
    ("haitong", fetch_haitong),
]


def main():
    ad = [a for a in ADAPTERS if (not ONLY or a[0] in ONLY)]
    sess = cffi.Session(impersonate="chrome")
    diffs, checked, applied, errors = [], 0, 0, []
    missing = []      # 官网有、库里没有的日期（说明抓取链路漏了某天，供日志提示）
    per_src = {}
    for name, fn in ad:
        t0 = time.time()
        try:
            got = fn(sess)
        except Exception as e:  # noqa: BLE001
            errors.append("%s: %s" % (name, str(e)[:120]))
            print("x %-11s adapter failed: %s" % (name, str(e)[:100]), flush=True)
            continue
        n_src = 0
        for (fid, d), nav in got.items():
            loc = local_recent(fid)
            if d not in loc:
                if len(missing) < 60:
                    missing.append({"id": fid, "date": d, "src": name})
                continue
            checked += 1
            n_src += 1
            old = loc[d]
            if abs(old - nav) > TOL * max(1.0, abs(nav)):
                diffs.append({
                    "id": fid, "name": (by_id.get(fid) or {}).get("fundBase")
                    or (by_id.get(fid) or {}).get("fund", ""),
                    "date": d, "old": old, "new": nav, "src": name,
                    "deltaPct": round((old / nav - 1) * 100, 3) if nav else None,
                })
        per_src[name] = {"checked": n_src, "secs": round(time.time() - t0, 1)}
        print("ok %-11s %4d pts  %.1fs" % (name, n_src, time.time() - t0), flush=True)

    if APPLY and diffs:
        for d0 in diffs:
            obj, p = load_hist(d0["id"])
            if not obj:
                continue
            s = obj.get("series") or []
            for row in s:
                if row[0] == d0["date"]:
                    row[1] = d0["new"]
                    applied += 1
                    break
            if s:
                obj["last"] = s[-1][1]
                obj["asOf"] = s[-1][0]
                obj["points"] = len(s)
                io.open(p, "w", encoding="utf-8", newline="").write(json.dumps(obj, ensure_ascii=False))

    report = {
        "runAt": dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "window": [WINDOW[0], WINDOW[-1]],
        "sources": per_src,
        "checked": checked,
        "applied": applied,
        "diffs": diffs,
        "missing": missing,
        "errors": errors,
    }
    io.open(OUT, "w", encoding="utf-8", newline="").write(json.dumps(report, ensure_ascii=False, indent=1))
    line = "[%s] 窗口 %s~%s 比对 %d 点，偏差 %d 条%s\n" % (
        report["runAt"], WINDOW[0], WINDOW[-1], checked, len(diffs),
        "，已修正 %d 条" % applied if APPLY else "（未写入）")
    if diffs:
        line = line.rstrip("\n") + "：" + "；".join(
            "%s %s %s→%s" % (d["name"][:12], d["date"], d["old"], d["new"]) for d in diffs[:8]) + "\n"
    with io.open(LOG, "a", encoding="utf-8") as fh:
        fh.write(line)
    print(line.strip())
    if missing:
        print("note: %d 个「官网已有、库里缺失」的日期（前 5 个：%s）" % (
            len(missing), ", ".join("%s %s" % (m["id"], m["date"]) for m in missing[:5])))
    if errors:
        print("adapter errors:", errors)


if __name__ == "__main__":
    main()
