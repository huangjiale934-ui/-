# -*- coding: utf-8 -*-
"""滙豐/恒生智選計劃 換源（tools/replace-mpfhk-hsbc.py）
====================================================================
官方便覽：www.hsbc.com.hk/mpf/ffs.pdf（滙豐智選）/ 恒生官網同名
2026Q2（截至 30/06/2026）——**每頁上下兩只基金**，頁首只標上半。
本腳本只處理「上半區塊歸屬明確」的頁（頁首標題=目標基金），其餘 10 只
（增長/保證/恒指/平穩/歐洲×2）官方便覽未載獨立頁，暫維持 mpf.hk 轉載並標注。

座標版式（p10 上半實測）：標題『投資組合內十大資產 Top 10 portfolio holdings (%)』
y≈211；名稱列 x 212-330（中文名一行 + 英文名下一行）；數值列 x≈374；
右欄評論 x≥396。名稱行距 ~5pt，中文名在數值行上方時需併入。

用法：python tools/replace-mpfhk-hsbc.py --write
"""
import json
import os
import re
import sys
import time

import pdfplumber

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, "data", "holdings.json")
ARCH = os.path.join(os.path.dirname(BASE), "mpf-app-tmp-archive", "2026-10-19")
ASOF = "2026-06-30"

# 只做頁首標題與目標基金一致的頁（上半區塊）
JOBS = [
    ("324", os.path.join(ARCH, "hsbc_ffs.pdf"), 9, "亞太股票基金"),
    ("303", os.path.join(ARCH, "hase_ffs.pdf"), 9, "亞太股票基金"),
]
SRC_MAP = {"hsbc_ffs.pdf": "滙豐強積金智選計劃基金概覽 PDF（FFS 2026Q2）",
           "hase_ffs.pdf": "恒生強積金智選計劃基金概覽 PDF（FFS 2026Q2）"}
VAL = re.compile(r"^\d{1,2}(?:\.\d+)?$")


def parse_top10_hsbc(pg, y_anchor):
    """上半十大區：數值列 x 365-385，名稱=同行 x<365 + 上方 3-9pt 的純名稱行"""
    ws = pg.extract_words(x_tolerance=2)
    seg = [w for w in ws if y_anchor + 2 < w["top"] < y_anchor + 170 and w["x0"] < 392]
    vals = [w for w in seg if VAL.match(w["text"]) and 360 <= w["x0"] <= 385]
    if len(vals) < 8:
        return []
    val_tops = {round(v["top"]) for v in vals}
    out = []
    for v in sorted(vals, key=lambda w: w["top"]):
        if v["top"] < y_anchor + 18:  # 表頭行（證券 Securities 持有量 Holdings (%)）
            continue
        nm = [w for w in seg if abs(w["top"] - v["top"]) <= 2.6
              and 205 <= w["x0"] and w["x1"] <= v["x0"] + 2 and not VAL.match(w["text"])
              and w["text"] not in ("Securities", "證券", "持有量", "(%)")]
        # 中文名在上一行（如：台灣半導體 / Taiwan Semiconductor Co Ltd 9.5）
        zh_up = [w for w in seg
                 if 2.5 < v["top"] - w["top"] <= 8.5 and 205 <= w["x0"] and w["x1"] <= 330
                 and re.search(r"[\u4e00-\u9fff]", w["text"])
                 and not any(abs(w["top"] - t) <= 2.6 for t in val_tops)]
        name = " ".join(w["text"] for w in sorted(nm, key=lambda z: z["x0"]))
        if zh_up and name:
            pre = " ".join(w["text"] for w in sorted(zh_up, key=lambda z: z["x0"]))
            name = pre + " " + name
        name = re.sub(r"\s+", " ", name).strip()
        if not name:
            continue
        out.append({"name": name[:80], "weight": float(v["text"])})
    # 去重（同行被拆兩行的情況）
    seen, dedup = set(), []
    for x in out:
        key = x["name"]
        if key not in seen:
            seen.add(key)
            dedup.append(x)
    return dedup[:10]


def main():
    write = "--write" in sys.argv
    hld = json.load(open(HOLD, encoding="utf-8"))
    n = 0
    for fid, path, pi, title in JOBS:
        if not os.path.exists(path):
            print("✘ 缺 PDF:", path)
            continue
        pdf = pdfplumber.open(path)
        pg = pdf.pages[pi]
        t = pg.extract_text() or ""
        head = " ".join(t.split()[:6])
        if title not in head:
            print("✘ #%s p%d 頁首非 %s: %s" % (fid, pi + 1, title, head))
            pdf.close()
            continue
        ws = pg.extract_words(x_tolerance=2)
        anc = next((w for w in ws if "投資組合內十大資產" in w["text"]), None)
        if not anc:
            print("✘ #%s p%d 未找到十大標題" % (fid, pi + 1))
            pdf.close()
            continue
        top = parse_top10_hsbc(pg, anc["top"])
        s = round(sum(x["weight"] for x in top), 2)
        print("#%s %s p%d top=%d 合計=%.2f" % (fid, os.path.basename(path), pi + 1, len(top), s))
        for x in top:
            print("    %-58s %5.1f" % (x["name"][:58], x["weight"]))
        pdf.close()
        if len(top) != 10 or not (20 <= s <= 75):
            print("  ✘ 不合規，跳過（寧缺勿錯）")
            continue
        rec = hld["funds"].setdefault(fid, {})
        rec["asOf"] = ASOF
        rec["top10"] = top
        rec["src"] = SRC_MAP[os.path.basename(path)]
        n += 1
    print("共 %d 條" % n)
    if write and n:
        hld["updatedAt"] = int(time.time() * 1000)
        srcs = set()
        for v in hld["funds"].values():
            if v.get("src"):
                srcs.add(v["src"].split("（")[0])
        hld["source"] = " + ".join(sorted(srcs))
        json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("已寫回")


if __name__ == "__main__":
    main()
