# -*- coding: utf-8 -*-
"""宏利季度持仓「发布探测」—— 每日跑一次，新季一上线当天就抓（tools/manulife-holdings-probe.py）
====================================================================
背景（2026-11-22 用户要求）：宏利是最重要的发行人（68 只），但官网「季度基金概覽」页面有
Akamai 反爬，PDF 链接不能稳定下载；而季报发布时点又不固定，靠「每季固定跑一次」必然漏。

解法：不走 HTML/PDF，改走官网基金详情 JSON 接口
  https://scmpf.manulife.com.hk/bin/funds/funddetail?id={code}&productLine=mpf
该接口用 curl_cffi 的 Chrome 指纹可稳定 200，直接返回 top10Holdings / portfolioAllocation
及其 asOfDate（UTC，+8h = HKT 估值日）。本脚本每天采样 2 只代表基金：
  · 若接口返回的 asOfDate 比 holdings.json 里该基金的 asOf 更新 → 打印 CHANGED
  · daily.sh 见到 CHANGED 立即调用 fetch-manulife-detail.py 全量刷新（当天完成，不用等季度计划日）

输出：data/probe/manulife-holdings.json
  { checkedAt, samples:[{code, asOf, count, allocCount, status}], holdingsAsOf, changed, reason }
用法：
  python tools/manulife-holdings-probe.py          # 探测（退出码恒为 0，结论看 stdout / json）
  python tools/manulife-holdings-probe.py --quiet  # 只写文件，不打印
"""
import datetime as dt
import glob
import json
import os
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "data", "probe", "manulife-holdings.json")
API = "https://scmpf.manulife.com.hk/bin/funds/funddetail"
# 两条产品线各一只：環球精選（SHK*）与退休精選（RB*），发布时间可能不同
PREFERRED = ["SHK122", "RBOA"]


def hkt_date(s):
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


def manulife_targets():
    """从 hist/*.json 找宏利系基金：(id, code)。"""
    out = []
    for fp in glob.glob(os.path.join(BASE, "data", "hist", "*.json")):
        try:
            h = json.load(open(fp, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            continue
        if "宏利" in str(h.get("src", "")) and h.get("code"):
            out.append((str(h.get("id")), str(h["code"]), h.get("name", "")))
    return out


def fetch(code):
    try:
        from curl_cffi import requests as cffi
    except Exception as e:  # noqa: BLE001
        return {"status": "no_curl_cffi", "err": str(e)}
    last = ""
    for i in range(3):
        try:
            r = cffi.get(API, params={"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"},
                         impersonate="chrome", timeout=45)
            if r.status_code != 200:
                last = "http_" + str(r.status_code)
                time.sleep(1.2 + i)
                continue
            d = (r.json() or {}).get("details") or {}
            fb = d.get("fundHoldingBreakdowns") or {}
            top = fb.get("top10Holdings") or {}
            alloc = fb.get("portfolioAllocation") or {}
            rows = top.get("data") or []
            if not fb:
                # 200 但没有持仓节点 = 源站结构改版（节点级监控）
                return {"status": "struct_miss", "err": "fundHoldingBreakdowns 缺失"}
            if not rows:
                return {"status": "empty", "asOf": hkt_date(top.get("asOfDate")), "count": 0,
                        "allocCount": len(alloc.get("data") or [])}
            return {"status": "ok", "asOf": hkt_date(top.get("asOfDate")), "count": len(rows),
                    "allocCount": len(alloc.get("data") or [])}
        except Exception as e:  # noqa: BLE001
            last = type(e).__name__
            time.sleep(1.2 + i)
    return {"status": "error", "err": last}


def main():
    quiet = "--quiet" in sys.argv
    tg = manulife_targets()
    by_code = {c: (fid, name) for fid, c, name in tg}
    codes = [c for c in PREFERRED if c in by_code]
    if len(codes) < 2:
        codes += [c for _, c, _ in tg if c not in codes][: 2 - len(codes)]

    try:
        hld = json.load(open(os.path.join(BASE, "data", "holdings.json"), encoding="utf-8"))
    except Exception:  # noqa: BLE001
        hld = {"funds": {}}
    funds = hld.get("funds") or {}

    samples, changed, reasons = [], False, []
    for code in codes:
        fid = by_code.get(code, ("", ""))[0]
        cur = (funds.get(fid) or {}).get("asOf") or ""
        r = fetch(code)
        r["code"] = code
        r["fundId"] = fid
        r["curAsOf"] = cur
        samples.append(r)
        if r.get("status") == "struct_miss":
            reasons.append("%s 接口 200 但缺持仓节点（疑似改版）" % code)
        if r.get("status") == "ok" and r.get("asOf") and (not cur or r["asOf"] > cur):
            changed = True
            reasons.append("%s %s → %s" % (code, cur or "无", r["asOf"]))

    prev = {}
    if os.path.exists(OUT):
        try:
            prev = json.load(open(OUT, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            prev = {}
    hist = (prev.get("history") or [])[-59:]
    now = dt.datetime.now(dt.timezone(dt.timedelta(hours=8))).isoformat(timespec="seconds")
    rec = {
        "checkedAt": now,
        "samples": samples,
        "holdingsCount": len(funds),
        "manulifeFunds": len(tg),
        "changed": changed,
        "reason": "; ".join(reasons),
        "history": hist + [{"at": now, "changed": changed,
                            "asOf": ",".join(sorted({s.get("asOf", "") for s in samples if s.get("asOf")})),
                            "status": ",".join(s.get("status", "") for s in samples)}],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8", newline="\n") as f:
        json.dump(rec, f, ensure_ascii=False, separators=(",", ":"))

    if not quiet:
        st = " / ".join("%s %s %s(%d)" % (s["code"], s.get("status"), s.get("asOf") or "-", s.get("count", 0))
                        for s in samples)
        print("[宏利探测] " + st)
        if changed:
            print("CHANGED " + rec["reason"])
        elif any(s.get("status") == "struct_miss" for s in samples):
            print("STRUCT_MISS " + rec["reason"])
        else:
            print("[宏利探测] 与库内一致，无需刷新")
    return 0


if __name__ == "__main__":
    sys.exit(main())
