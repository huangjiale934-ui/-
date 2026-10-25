# -*- coding: utf-8 -*-
"""
中国人寿（China Life）历史净值 —— 官网 OnePartner API
====================================================================
数据源：https://onepartner.chinalife.com.hk/prod-api/fundInformation/
  · getLastestFundPriceList            → 全部基金当日价格 + fundCd/zhhkNm（名称映射用）
  · getFundPriceDataByDate?fundCd=XXX  → 该基金**全历史**逐日价格（offer/bid，自成立日起）
页面：https://trustee.chinalife.com.hk/mpf/dailyPrices（SPA，上述 API 由 netlog 捕获）
输出：data/hist/<id>.json（src=chinalife）+ 合并 data/hist-index.json
用法：python fetch-chinalife-hist.py [--dry]
"""
import json
import os
import sys
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
API = "https://onepartner.chinalife.com.hk/prod-api/fundInformation/"
SRC = "中國人壽信託官網（OnePartner API）"
H = {"Accept": "application/json, text/plain, */*",
     "Referer": "https://trustee.chinalife.com.hk/mpf/dailyPrices?request_locale=zh_TW"}


def norm(s):
    return str(s or "").replace(" ", "").replace("*", "").strip()


def main():
    dry = "--dry" in sys.argv
    s = cffi.Session(impersonate="chrome")
    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ours = {norm(x["fund"]): x for x in funds if x.get("trustee") == "中國人壽"}

    # 1) 最新价 → fundCd 映射
    r = s.get(API + "getLastestFundPriceList", headers=H, timeout=60)
    j = r.json()
    latest = j.get("data") or []
    code_of = {}
    for f in latest:
        nm = norm(f.get("zhhkNm"))
        if nm in ours:
            code_of[f["fundCd"]] = ours[nm]
    print("中國人壽基金 %d 只（我方 %d）" % (len(latest), len(ours)), flush=True)

    # 2) 逐基金拉全历史
    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}
    saved = 0
    for i, (fc, x) in enumerate(sorted(code_of.items())):
        try:
            r = s.get(API + "getFundPriceDataByDate", params={"fundCd": fc}, headers=H, timeout=120)
            arr = r.json().get("data") or []
        except Exception as e:  # noqa: BLE001
            print("  [!] %s %s 失败 %s" % (fc, x["fund"][:14], str(e)[:60]), flush=True)
            continue
        pts = []
        for row in arr:
            d = row.get("effDate")
            p = row.get("offerPrice")
            if d and p is not None:
                pts.append([d, float(p)])
        if len(pts) < 20:
            print("  [!] %s %s 数据点不足（%d）" % (fc, x["fund"][:14], len(pts)), flush=True)
            continue
        pts.sort()
        fid = str(x["id"])
        obj = {"id": fid, "code": fc, "name": x["fund"], "unit": x.get("unit", ""),
               "scheme": x.get("scheme", ""), "src": SRC,
               "note": "官網 OnePartner API（認購價，逐日）",
               "asOf": pts[-1][0], "last": pts[-1][1], "first": pts[0][0],
               "points": len(pts), "series": pts}
        with open(os.path.join(HIST_DIR, fid + ".json"), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        idx[fid] = {"code": fc, "src": "chinalife", "name": obj["name"], "unit": obj["unit"],
                    "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                    "first": obj["first"], "points": obj["points"]}
        saved += 1
        print("  ✓ %s %s：%s → %s · %d 点" % (fc, x["fund"][:16], pts[0][0], pts[-1][0], len(pts)), flush=True)
        time.sleep(0.6)
        if dry and saved >= 2:
            break
    with open(INDEX, "w", encoding="utf-8") as fh:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系 + 中银保诚 + 中国人寿）",
                   "count": len(idx), "funds": idx}, fh, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：写入 %d 只（hist-index 共 %d）" % (saved, len(idx)))


if __name__ == "__main__":
    main()
