# -*- coding: utf-8 -*-
"""nav-etnet.py —— 108 只（富達/海通/東亞/萬通/AMTD）当日净值刷新
数据源：etnet 環富通（mpfDetail.do）「價格 (HKD)（截至 YYYY/MM/DD）」
写入：data/nav.json items（按 方案+基金名 匹配定位），src='etnet 環富通（官方價，逐日）'
"""
import json
import os
import re
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
NAV = os.path.join(BASE, "data", "nav.json")
MATCH = os.path.join(BASE, "data", "etnet-match.json")
FUNDS = os.path.join(BASE, "data", "funds.json")

s = cffi.Session(impersonate="chrome")
H = {"Referer": "https://www.etnet.com.hk/www/tc/mpf/fund_detail.php"}

RGX1 = re.compile(r"價格\s*\(HKD\)[\s\S]{0,200}?截至\s*(\d{4})/(\d{1,2})/(\d{1,2})[\s\S]{0,500}?ETWFundQuote[^>]*>\s*([\d]+\.[\d]{2,6})")
RGX2 = re.compile(r"截至\s*(\d{4})/(\d{1,2})/(\d{1,2})[\s\S]{0,400}?ETWFundQuote[^>]*>\s*([\d]+\.[\d]{2,6})")


def nz(v):
    return re.sub(r"[\s\-–—·,，.。（）()「」/]", "", str(v or ""))


def main():
    navj = json.load(open(NAV, encoding="utf-8"))
    items = navj.get("items") or {}
    match = json.load(open(MATCH, encoding="utf-8"))
    funds = {str(x["id"]): x for x in json.load(open(FUNDS, encoding="utf-8"))["funds"]}

    bykey = {}
    for it in items:
        bykey[(nz(it.get("scheme")), nz(it.get("fund")))] = it

    ok = fail = 0
    dates = {}
    for fid, m in match.items():
        try:
            r = s.get(
                "https://fc10.etwealth.com/wfc-etnet-hk/mpfDetail.do",
                params={"method": "searchMpfDetail", "locale": "zh_TW", "appId": "etnet-hk",
                        "fd_id": m["etnet"], "backUrl": ""},
                headers=H, timeout=40)
            t = r.text
            mm = RGX1.search(t) or RGX2.search(t)
            if not mm:
                fail += 1
                continue
            asOf = "%s-%02d-%02d" % (mm.group(1), int(mm.group(2)), int(mm.group(3)))
            price = float(mm.group(4))
            fx = funds.get(str(fid)) or {}
            full = nz(fx.get("fundBase") or fx.get("fund"))
            it = bykey.get((nz(fx.get("scheme")), full))
            if it is None:
                # 模糊兜底：同方案下 nav 名被截断（如 '5歲後基金' ⊂ '65歲後基金'）
                cand = None
                for it2 in items:
                    if nz(it2.get("scheme")) != nz(fx.get("scheme")):
                        continue
                    nv = nz(it2.get("fund"))
                    if nv and nv in full and len(nv) >= 4:
                        cand = it2
                        break
                it = cand
                if it is not None:
                    it["fund"] = fx.get("fundBase") or fx.get("fund")   # 顺带修复截断名称
            if it is None:
                fail += 1
                continue
            # 2026-10-17：只补官方源失败的（官方值更新则绝不回退）
            if it.get("asOf") and str(it.get("asOf")) >= asOf and "etnet" not in str(it.get("src") or ""):
                ok += 1
                continue
            it["nav"] = price
            it["na"] = False
            it["asOf"] = asOf
            it["src"] = "etnet 環富通（官方價，逐日）"
            it["srcUrl"] = "https://www.etnet.com.hk/www/tc/mpf/fund_detail.php?fund=%s" % m["etnet"]
            ok += 1
            dates[asOf] = dates.get(asOf, 0) + 1
        except Exception:
            fail += 1
        time.sleep(0.35)

    navj["items"] = items
    navj["updatedAt"] = int(time.time() * 1000)
    srcs = [x for x in (navj.get("sources") or []) if x.get("key") != "etnet"]
    srcs.append({"key": "etnet", "label": "etnet 環富通（官方價，逐日）",
                 "url": "https://www.etnet.com.hk/www/tc/mpf/",
                 "asOf": max(dates) if dates else "", "count": ok, "na": 0})
    navj["sources"] = srcs
    json.dump(navj, open(NAV, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("etnet 刷新：成功 %d / 失败 %d | %s" % (ok, fail, json.dumps(dates, ensure_ascii=False)))


if __name__ == "__main__":
    main()
