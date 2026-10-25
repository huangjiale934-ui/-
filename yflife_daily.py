# -*- coding: utf-8 -*-
"""万通日度净值入库（yflife_daily.py）—— YF Life 官网 fundPriceDetail API
====================================================================
发现路径（2026-10-18）：
1. 列表 API：POST /aisite-applyapi/mo/moCompanyFund/fundList {"local":"HK"}
   → 14 只 {fund_code, fund_name, unit_price, price_date, path_name(fact_sheet PDF)}
2. 日度：POST /aisite-applyapi/mo/moCompanyFund/fundPriceDetail
   {"fundCode":"GLSF","queryType":"TIM","startDate":"2000-01-01","endDate":"YYYY-MM-DD"}
   → data:[{unit_price, price_date:"MM/DD/YYYY"}]（TIM=自定义区间；FTD 需 dateType）
3. 映射：用当前 nav 与 API unit_price 精确匹配（14 只全部对上）
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

API = "https://www.yflife.com/aisite-applyapi/mo/moCompanyFund/"
H = {"Content-Type": "application/json", "Accept": "application/json",
     "Referer": "https://www.yflife.com/sc/product/mpf-hongkong/fund-price-history/",
     "Origin": "https://www.yflife.com"}


def d2iso(s):
    """MM/DD/YYYY -> YYYY-MM-DD"""
    m = s.strip().split("/")
    if len(m) != 3:
        return None
    return "%s-%02d-%02d" % (m[2], int(m[0]), int(m[1]))


def main():
    s = cffi.Session(impersonate="chrome")
    r = s.post(API + "fundList", json={"local": "HK"}, headers=H, timeout=60)
    funds = r.json()["data"]
    print("万通基金:", len(funds))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    yf = [x for x in FN if "萬通" in (x.get("scheme") or "") or "萬通" in (x.get("trustee") or "")]
    CODE_MAP = json.load(open(os.path.join(BASE, "tools", "yflife-code-map.json"), encoding="utf-8"))
    idx = json.load(open(INDEX, encoding="utf-8"))
    today = datetime.date.today().isoformat()
    ok = skip = 0
    for f in funds:
        code = f["fund_code"]
        up = round(float(f["unit_price"]), 4)
        # 2026-10-25 修 P2-5：原按 nav 值匹配（本站 nav 与 API 最新价不同步时全 skip），
        # 改为 fund_code 映射表（tools/yflife-code-map.json，价格+名称双重验证生成）
        mine = [x for x in yf if CODE_MAP.get(str(x["id"])) == code]
        if len(mine) != 1:
            print("✘ %s %s：code 映射 %d 条（映射表需更新）" % (code, f["fund_name"][:22], len(mine)))
            skip += 1
            continue
        x = mine[0]
        try:
            rr = s.post(API + "fundPriceDetail",
                        json={"fundCode": code, "queryType": "TIM",
                              "startDate": "2000-01-01", "endDate": today},
                        headers=H, timeout=90)
            d = rr.json()
            rows = d.get("data") or []
            pts = []
            for row in rows:
                iso = d2iso(row.get("price_date") or "")
                if iso and row.get("unit_price") not in (None, ""):
                    pts.append([iso, round(float(row["unit_price"]), 4)])
            pts.sort(key=lambda p: p[0])
            if len(pts) < 5:   # 2026-10-22：放宽门槛
                print("✘ #%s %s：仅 %d 点" % (x["id"], f["fund_name"][:20], len(pts)))
                skip += 1
                continue
            last = pts[-1]
            obj = {
                "id": x["id"], "code": code, "name": x.get("fundBase", x["fund"]),
                "unit": x.get("unit", ""), "scheme": x.get("scheme", ""),
                "src": "萬通信託官網基金價格歷史 API（逐日單位價格）",
                "note": "万通保险官网「基金价格历史」接口（/aisite-applyapi fundPriceDetail）",
                "asOf": d2iso(f.get("price_date") or "") or last[0], "last": last[1],
                "first": pts[0][0], "points": len(pts), "series": pts,
            }
            with open(os.path.join(HIST, "%s.json" % x["id"]), "w", encoding="utf-8") as fh:
                json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
            idx["funds"][str(x["id"])] = {
                "code": code, "src": "yflife", "name": obj["name"], "unit": obj["unit"],
                "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                "first": obj["first"], "points": len(pts),
            }
            ok += 1
            print("✔ #%s %s ← %s（%d 点，%s ~ %s）" % (x["id"], f["fund_name"][:20], code, len(pts), pts[0][0], last[0]), flush=True)
        except Exception as e:
            print("✘ #%s %s: %s" % (x["id"], f["fund_name"][:20], str(e)[:60]), flush=True)
            skip += 1
        time.sleep(0.4)
    idx["count"] = len(idx["funds"])
    idx["updatedAt"] = int(time.time() * 1000)
    json.dump(idx, open(INDEX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：OK %d / skip %d；hist-index 共 %d 只" % (ok, skip, len(idx["funds"])))


if __name__ == "__main__":
    main()
