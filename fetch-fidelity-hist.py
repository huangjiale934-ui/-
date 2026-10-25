# -*- coding: utf-8 -*-
"""富达日度净值入库（fetch-fidelity-hist.py）—— 富達退休集成信託 23 只全历史
====================================================================
发现路径（2026-10-18）：
1. factsheet 页 https://www.fidelity.com.hk/zh/funds/factsheet/<CODE>/ 是 Angular SPA，
   页面被 Akamai JS 挑战（headless 被拦），但**数据 API 不走挑战，curl_cffi 直调即可**。
2. 基金代码枚举：GET /api/ce/fdh/FundSearch.json → fundRangeCode=FRMT 的 23 只（含 code/name/isin）
3. 日度 NAV：GET /api/ce/fdh/NavChartData.json?id=<CODE> → {date, series:[{name,data:[[ms,nav]...]}]}
   （PerformanceChartData.json 为归一化表现；CEUR 实测 767 点，末值 13.3791 与官网一致）
4. 基金报告 PDF（持仓）：/api/ce/fdh/FundDocuments.json?isins=<CODE>
"""
import datetime
import json
import os
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")

Q = "countries=hk&country=hk&languages=zh%2Cen&language=zh&channels=ce.private-investor&channel=ce.private-investor"
H = {"Accept": "application/json, text/plain, */*", "Accept-Language": "zh-TW,zh;q=0.9"}
REFERER = "https://www.fidelity.com.hk/zh/funds/factsheet/CEUR/"


def iso(ms):
    return (datetime.datetime.fromtimestamp(ms / 1000, datetime.timezone(datetime.timedelta(hours=8)))
            .strftime("%Y-%m-%d"))


def main():
    s = cffi.Session(impersonate="chrome")
    # 1) 枚举 FRMT 23 只
    r = s.get("https://www.fidelity.com.hk/api/ce/fdh/FundSearch.json?" + Q,
              headers={**H, "Referer": REFERER}, timeout=60)
    frmt = [x for x in r.json() if x.get("fundRangeCode") == "FRMT"]
    print("FRMT 基金:", len(frmt))
    # 2) 我们的 451 清单富达条目（按 fundBase 名称匹配）
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    mine = {x.get("fundBase") or x.get("fund"): x for x in FN if "富達" in (x.get("scheme") or "")}
    idx = json.load(open(INDEX, encoding="utf-8"))
    ok = skip = 0
    for f in frmt:
        code = f["id"].split("/")[0]
        name = f["name"]
        x = mine.get(name)
        if not x:
            # 容错：去空格/「富達」前缀再试
            for k, v in mine.items():
                if k.replace(" ", "") == name.replace(" ", ""):
                    x = v
                    break
        if not x:
            print("✘ 未匹配我们的清单:", code, name)
            skip += 1
            continue
        try:
            rr = s.get("https://www.fidelity.com.hk/api/ce/fdh/NavChartData.json?id=%s&%s" % (code, Q),
                       headers={**H, "Referer": "https://www.fidelity.com.hk/zh/funds/factsheet/%s/" % code},
                       timeout=60)
            d = rr.json()
            ser = d.get("series") or []
            if not ser or not ser[0].get("data"):
                print("✘ #%s %s：无序列" % (x["id"], name[:16]))
                skip += 1
                continue
            pts = [[iso(ms), round(float(v), 4)] for ms, v in ser[0]["data"] if v is not None]
            pts.sort(key=lambda p: p[0])
            oldp = idx["funds"].get(str(x["id"]), {}).get("points", 0)
            if len(pts) < oldp:
                print("· #%s %s：新数据 %d < 旧 %d，保留旧" % (x["id"], name[:14], len(pts), oldp))
                skip += 1
                continue
            obj = {
                "id": x["id"], "code": code, "name": x.get("fundBase", x["fund"]),
                "unit": x.get("unit", ""), "scheme": x.get("scheme", ""),
                "src": "富達退休集成信託官網 NavChartData API（逐日單位資產淨值）",
                "note": "富达退休集成信托官网基金专页「表现图表」接口，asOf %s" % d.get("date", ""),
                "asOf": d.get("date") or pts[-1][0], "last": pts[-1][1], "first": pts[0][0],
                "points": len(pts), "series": pts,
            }
            with open(os.path.join(HIST, "%s.json" % x["id"]), "w", encoding="utf-8") as fh:
                json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
            idx["funds"][str(x["id"])] = {
                "code": code, "src": "fidelity-navchart", "name": obj["name"],
                "unit": obj["unit"], "scheme": obj["scheme"], "asOf": obj["asOf"],
                "last": obj["last"], "first": obj["first"], "points": len(pts),
            }
            ok += 1
            print("✔ #%s %s ← %s（%d 点，%s ~ %s）" % (x["id"], name[:16], code, len(pts), pts[0][0], pts[-1][0]), flush=True)
        except Exception as e:
            print("✘ #%s %s: %s" % (x["id"], name[:14], str(e)[:60]), flush=True)
            skip += 1
        time.sleep(0.4)
    idx["count"] = len(idx["funds"])
    idx["updatedAt"] = int(time.time() * 1000)
    json.dump(idx, open(INDEX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：OK %d / skip %d；hist-index 共 %d 只" % (ok, skip, len(idx["funds"])))


if __name__ == "__main__":
    main()
