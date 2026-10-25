# -*- coding: utf-8 -*-
"""
渣打信托（新地強積金僱主營辦計劃 SHKP ESS）历史净值 —— 官网 Fund Price PDF
====================================================================
数据源：https://www.shkp.com/Html/MPF/Fund%20Price%20and%20FFS%20for%20SHKPESS.pdf
  · 42 页逐日价格（约 283 个交易日，回溯约 14 个月）
  · 每行：DD/MM/YYYY + 11 个数值（第 1 列为「宏利在職平均回報」基准，其后 10 只成分基金）
  · 列序：保證基金－新地 / 景順強積金保守基金 / 安聯精選均衡基金 / 安聯精選穩定增長基金 /
           富達均衡基金 / 富達穩定增長基金 / 新地強積金基金 / 景順環球穩定基金 /
           施羅德強積金65歲後基金 / 施羅德強積金核心積基金
输出：data/hist/<id>.json（src=shkp）+ 合并 data/hist-index.json
用法：python fetch-shkp-hist.py
"""
import datetime as dt
import json
import os
import re
import time

from curl_cffi import requests as cffi
from pypdf import PdfReader

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
URL = "https://www.shkp.com/Html/MPF/Fund%20Price%20and%20FFS%20for%20SHKPESS.pdf"
CACHE = os.path.join(BASE, "tmp", "shkp.pdf")
SRC = "新地／渣打信託官網（SHKP ESS Fund Price PDF）"

# PDF 列序 → 我方基金名（跳过第 1 列「宏利在職平均回報」基准）
COLS = [
    "宏利在職平均回報保證基金 - 新地",
    "景順強積金保守基金",
    "安聯精選均衡基金",
    "安聯精選穩定增長基金",
    "富達均衡基金",
    "富達穩定增長基金",
    "新地強積金基金",
    "景順環球穩定基金",
    "施羅德強積金65歲後基金",
    "施羅德強積金核心累積基金",
]


def main():
    if not os.path.exists(CACHE):
        print("下载 SHKP PDF…", flush=True)
        r = cffi.get(URL, impersonate="chrome", timeout=180)
        r.raise_for_status()
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        open(CACHE, "wb").write(r.content)
    reader = PdfReader(CACHE)
    series = {nm: {} for nm in COLS}
    n_rows = 0
    for pg in reader.pages:
        t = pg.extract_text() or ""
        for m in re.finditer(r"(\d{2})/(\d{2})/(\d{4})\s+((?:\d+\.\d+\s+){6,11})", t):
            dd, mm, yy = m.group(1), m.group(2), m.group(3)
            try:
                d = dt.date(int(yy), int(mm), int(dd)).isoformat()
            except ValueError:
                continue
            vals = [float(x) for x in m.group(4).split()]
            # 2026-10-15 修正：数据行为 10 列（即 10 只基金，无基准列）；若出现 11 列则首列为基准
            if len(vals) >= 11:
                fund_vals = vals[1:11]
            elif len(vals) == 10:
                fund_vals = vals
            else:
                fund_vals = vals[-10:]
            for i, nm in enumerate(COLS):
                if i < len(fund_vals):
                    series[nm][d] = fund_vals[i]
            n_rows += 1
    print("解析 %d 行" % n_rows, flush=True)

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ours = {x["fund"]: x for x in funds if x.get("trustee") == "渣打信托"}
    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}
    saved = 0
    for nm in COLS:
        x = ours.get(nm)
        if not x:
            print("  [!] %s 未匹配" % nm)
            continue
        pts = sorted(series[nm].items())
        if len(pts) < 5:   # 2026-10-22：放宽门槛
            print("  [!] %s 点数不足（%d）" % (nm, len(pts)))
            continue
        fid = str(x["id"])
        obj = {"id": fid, "code": "", "name": nm, "unit": x.get("unit", ""),
               "scheme": x.get("scheme", ""), "src": SRC,
               "note": "官網 Fund Price PDF（逐日）",
               "asOf": pts[-1][0], "last": pts[-1][1], "first": pts[0][0],
               "points": len(pts), "series": [[k, v] for k, v in pts]}
        with open(os.path.join(HIST_DIR, fid + ".json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        idx[fid] = {"code": "", "src": "shkp", "name": nm, "unit": obj["unit"],
                    "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                    "first": obj["first"], "points": obj["points"]}
        saved += 1
        print("  ✓ %s：%s → %s · %d 点" % (nm, pts[0][0], pts[-1][0], len(pts)), flush=True)
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系 + 中银保诚 + 中国人寿 + 永明 + 交通银行 + 新地/渣打）",
                   "count": len(idx), "funds": idx}, f, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：写入 %d 只（hist-index 共 %d）" % (saved, len(idx)))


if __name__ == "__main__":
    main()
