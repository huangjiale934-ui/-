# -*- coding: utf-8 -*-
"""万通持仓解析（yflife_holdings.py）—— 14 只 fact_sheet PDF
====================================================================
PDF：https://app2.yflife.com/MPFWeb/pdf/fact_sheet/<CODE>_C.pdf（中文版）
结构（p2）：
  「投資組合內十大資產#」+ 表头「所持資產 資產淨值百分比」
  → 每行「名称 xx.xx%」（文本流清晰）
  「投資組合分佈#^」→ 柱状图标签（名称与百分比交错，用坐标法尽力提取）
asOf：「於2026年09月刊印」→ 月末日期
"""
import json
import os
import re
import time

import pdfplumber
from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF_DIR = os.path.join(BASE, "tmp", "yfl_pdf")

# code -> 清单 id（用 nav 匹配或直接映射）
CODE2ID = {}  # 运行时填充


def parse_pdf(path):
    pdf = pdfplumber.open(path)
    top10, alloc, asof = [], [], None
    full = "\n".join((pg.extract_text() or "") for pg in pdf.pages)
    # asOf：於2026年09月刊印
    m = re.search(r"於(20\d{2})年(\d{1,2})月刊印", full)
    if m:
        yy, mm = int(m.group(1)), int(m.group(2))
        end_day = [31, 29 if yy % 4 == 0 else 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1]
        asof = "%04d-%02d-%02d" % (yy, mm, end_day)
    # TOP TEN
    i = full.find("投資組合內十大資產")
    if i >= 0:
        seg = full[i:i + 1200]
        for l in seg.split("\n"):
            s = l.strip()
            if not s or "所持資產" in s or "資產淨值百分比" in s:
                continue
            m = re.match(r"^(.{3,90}?)\s+(\d+\.\d+)%$", s)
            if m:
                top10.append({"name": m.group(1).strip(), "weight": float(m.group(2))})
            if len(top10) >= 10:
                break
    # ALLOC（坐标法）：名称分左右栏（x 280-340 / 490-520），数值同栏、位于名称下方
    try:
        pg = pdf.pages[1] if len(pdf.pages) > 1 else pdf.pages[0]
        words = pg.extract_words(x_tolerance=3)
        names_L = [(w["top"], w["text"]) for w in words if 280 <= w["x0"] <= 340 and re.search(r"[\u4e00-\u9fff]", w["text"]) and 2 <= len(w["text"]) <= 10]
        names_R = [(w["top"], w["text"]) for w in words if 485 <= w["x0"] <= 520 and re.search(r"[\u4e00-\u9fff]", w["text"]) and 2 <= len(w["text"]) <= 10]
        nums_L = [(w["top"], w["text"]) for w in words if 300 <= w["x0"] <= 330 and re.match(r"^\d+\.\d%$", w["text"])]
        nums_R = [(w["top"], w["text"]) for w in words if 490 <= w["x0"] <= 520 and re.match(r"^\d+\.\d%$", w["text"])]
        BAD = ("資料來源", "刊印", "價格", "表現", "年", "月", "基金回報", "類別")
        def pair(nms, nms_other, nums):
            out = []
            for ny, nm in nms:
                if any(b in nm for b in BAD):
                    continue
                # 数值：y 在名称下方 0-14pt，且在任何名称之前
                cand = [(ty, tv) for ty, tv in nums if 0 < ty - ny <= 14]
                if not cand:
                    continue
                ty, tv = min(cand, key=lambda x: x[0] - ny)
                out.append({"label": nm, "weight": float(tv.rstrip("%"))})
            return out
        alloc = pair(names_L, names_R, nums_L) + pair(names_R, names_L, nums_R)
        # 去重
        seen = set()
        alloc2 = []
        for a in alloc:
            if a["label"] not in seen:
                seen.add(a["label"])
                alloc2.append(a)
        alloc = alloc2
    except Exception:
        pass
    pdf.close()
    return asof, top10, alloc


def main():
    s = cffi.Session(impersonate="chrome")
    H = {"Referer": "https://www.yflife.com/sc/product/mpf-hongkong/fund-price-history/"}
    r = s.post("https://www.yflife.com/aisite-applyapi/mo/moCompanyFund/fundList",
               json={"local": "HK"}, headers={**H, "Content-Type": "application/json"}, timeout=60)
    funds = r.json()["data"]
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    yf = [x for x in FN if "萬通" in (x.get("trustee") or "") or "萬通" in (x.get("scheme") or "")]
    hld = json.load(open(HOLD, encoding="utf-8"))
    os.makedirs(PDF_DIR, exist_ok=True)
    ok = 0
    for f in funds:
        code = f["fund_code"]
        up = round(float(f["unit_price"]), 4)
        mine = [x for x in yf if x.get("nav") is not None and abs(float(x["nav"]) - up) < 1e-6]
        if len(mine) != 1:
            print("✘ %s 匹配 %d 条" % (code, len(mine)))
            continue
        x = mine[0]
        dest = os.path.join(PDF_DIR, code + ".pdf")
        if not (os.path.exists(dest) and os.path.getsize(dest) > 10000):
            rr = s.get("https://app2.yflife.com/MPFWeb/pdf/fact_sheet/%s_C.pdf" % code,
                       headers={"User-Agent": "Mozilla/5.0", "Referer": "https://www.yflife.com/"}, timeout=90)
            if rr.status_code != 200 or rr.content[:4] != b"%PDF":
                print("✘ %s PDF 下载失败" % code)
                continue
            open(dest, "wb").write(rr.content)
        asof, top10, alloc = parse_pdf(dest)
        if not top10:
            print("✘ %s %s：PDF 无 top10" % (code, x.get("fundBase", "")[:16]))
            continue
        hld["funds"][str(x["id"])] = {
            "asOf": asof,
            "src": "萬通信託基金便覽 PDF（fact_sheet，月度）",
            "top10": top10,
            "alloc": alloc,
            "allocLabel": "投資組合分佈（%）" if alloc else None,
        }
        ok += 1
        print("✔ #%s %s ← %s top10=%d alloc=%d asOf=%s" % (
            x["id"], (x.get("fundBase") or "")[:16], code, len(top10), len(alloc), asof), flush=True)
        time.sleep(0.4)
    hld["count"] = len(hld["funds"])
    hld["updatedAt"] = int(time.time() * 1000)
    srcs = set()
    for v in hld["funds"].values():
        if v.get("src"):
            srcs.add(v["src"].split("（")[0])
    hld["source"] = " + ".join(sorted(srcs))
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：写入 %d 只；holdings 共 %d" % (ok, hld["count"]))


if __name__ == "__main__":
    main()
