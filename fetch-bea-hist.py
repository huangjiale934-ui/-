# -*- coding: utf-8 -*-
"""東亞 MPF 全历史日度净值（fetch-bea-hist.py）
====================================================================
数据源（2026-10-19 用户指出）：https://www.hkbea.com/jsp/hk/bea-mpf-fund-information2.jsp?language=sc
  页面「基金表现走势图」用 POST /GetMPFData {id: 0|1|2} 取全量逐日单位价格：
    0 = 集成信托 MT / 1 = 行业计划 IS / 2 = 享惠计划 VS
  返回 {"MT": {"GRF": [{"x":<ms>, "y":<nav>}, ...]}, "RunningDate": "...", "CheckSum": "..."}
  每只 6386 点，2000-12-01 起（页面首次可选起点 01/09/2005 只是默认筛选）。
  同时页面 JS 内含 funds 数组（name↔value）与 launchDates，可作为代码对照。
用法：python fetch-bea-hist.py [--dry]
"""
import json
import os
import re
import sys
from datetime import datetime, timezone

from curl_cffi import requests

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST = os.path.join(DATA, "hist")
IDX = os.path.join(DATA, "hist-index.json")

PAGE = "https://www.hkbea.com/jsp/hk/bea-mpf-fund-information2.jsp?language=sc"
API = "https://www.hkbea.com/GetMPFData"

# 代码 → 我们的基金 id（2026-10-19 按 fundBase 逐只核对）
MAP = {
    # 集成信托 MT
    "AGF": 221, "EEF": 814, "GEF": 813, "GCF": 218, "HGF": 220, "JGF": 217,
    "NEF": 896, "CTF": 897, "HTF": 898, "APF": 1538, "BAF": 216, "CAF": 1537,
    "GRF": 224, "STF": 223, "GBF": 219, "MCF": 225, "RHF": 912,
    # 享惠 VS
    "VAEF": 1044, "VGEF": 1043, "VGCF": 1045, "VHTF": 1047, "VAPF": 1540,
    "VBAF": 1041, "VGRF": 1040, "VSTF": 1042, "VCAF": 1539, "VGBF": 1048, "VMCF": 1039,
    # 行业 IS
    "IAGF": 899, "IGCF": 812, "IHGF": 811, "ICTF": 900, "IHTF": 901, "IAPF": 1536,
    "IBAF": 212, "ICAF": 1535, "IGRF": 215, "ISTF": 214, "IMCF": 213, "IRHF": 913,
}


def ms2d(ms):
    return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).strftime("%Y-%m-%d")


def main():
    dry = "--dry" in sys.argv
    s = requests.Session(impersonate="chrome")
    html = s.get(PAGE, timeout=60).text
    # 页面 JS 的 name↔value 对照（用于核对，不参与匹配）
    pairs = dict((m.group(2), m.group(1)) for m in
                 re.finditer(r"\{name:\s*'([^']+)',\s*value:\s*'([A-Z]+)'", html))
    print("页面基金条目 %d" % len(pairs))

    series = {}
    for pid, key in ((0, "MT"), (1, "IS"), (2, "VS")):
        r = s.post(API, data={"id": pid}, timeout=180,
                   headers={"X-Requested-With": "XMLHttpRequest", "Referer": PAGE})
        t = r.text[:r.text.rfind("}") + 1]
        d = json.loads(t)
        sub = d[key]
        print("  %s: %d 只，RunningDate=%s" % (key, len(sub), d.get("RunningDate")))
        for code, arr in sub.items():
            if code not in MAP:
                print("    · 跳过未映射代码 %s（%s）" % (code, pairs.get(code, "?")))
                continue
            pts = []
            for p in arr:
                y = p.get("y")
                if y is None or y <= 0:
                    continue
                pts.append([ms2d(p["x"]), round(float(y), 4)])
            pts.sort()
            series[MAP[code]] = (code, pairs.get(code, ""), pts)

    FN = {str(x["id"]): x for x in json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]}
    idx = json.load(open(IDX, encoding="utf-8"))
    os.makedirs(HIST, exist_ok=True)
    ok = 0
    for fid, (code, nm, pts) in sorted(series.items(), key=lambda z: -len(z[1][2])):
        f = FN.get(str(fid))
        if not f:
            print("✘ id %s 不在 funds.json" % fid)
            continue
        if len(pts) < 50:
            print("✘ #%s %s 点太少 %d" % (fid, f["fundBase"], len(pts)))
            continue
        last = pts[-1][1]
        rec = {
            "id": int(fid), "code": code, "name": f.get("fundBase"), "unit": f.get("unit") or "",
            "scheme": f.get("scheme"),
            "src": "東亞銀行官網（GetMPFData 全量日度單位價格）",
            "note": "官方逐日單位價格，%s 起共 %d 點" % (pts[0][0], len(pts)),
            "asOf": pts[-1][0], "last": last, "first": pts[0][0], "points": len(pts),
            "series": pts,
        }
        print("  ✔ #%-5s %-26s %-5s %s → %s  %d 点  首 %s  末 %s" % (
            fid, f["fundBase"][:26], code, (f.get("unit") or "")[:4], pts[-1][0], len(pts), pts[0][0], last))
        if not dry:
            json.dump(rec, open(os.path.join(HIST, "%s.json" % fid), "w", encoding="utf-8"),
                      ensure_ascii=False, separators=(",", ":"))
            idx["funds"][str(fid)] = {
                "code": code, "src": "bea", "name": f.get("fundBase"), "unit": f.get("unit") or "",
                "scheme": f.get("scheme"), "asOf": pts[-1][0], "last": last,
                "first": pts[0][0], "points": len(pts),
            }
        ok += 1
    if not dry:
        idx["updatedAt"] = int(datetime.now().timestamp() * 1000)
        idx["count"] = len(idx["funds"])
        srcs = set(v.get("src") for v in idx["funds"].values())
        idx["source"] = " + ".join(sorted(x for x in srcs if x))
        json.dump(idx, open(IDX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：%d 只%s" % (ok, "" if not dry else "（dry，未写盘）"))


if __name__ == "__main__":
    main()
