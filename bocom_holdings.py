# -*- coding: utf-8 -*-
"""交通银行信托持仓解析（bocom_holdings.py）
====================================================================
数据源：https://www.bocomtrust.com.hk/BankCommSite/upload/infos/<yyyymm>/<dd>/<fileId>/<ts>_MPF_FFS(2026Q2)_Final.pdf
  发现路径：基金便覽列表页 → previewPdf.html?fileId=xxx → iframe 的 pdfjs viewer URL 内含真实 upload 路径
  （/SITE/fileDownload.upload 需 JS 签名，不可直调；upload 目录是静态文件可直下）
结构：每页一只基金（8 页 8 只）；「十大資產 Top 10 Holdings*」区块：
  行格式 `1. US Treasury Note/Bond 4.375% 01/32 5.4%`（序号. 名称 … 权重%）
  资产分布「債券 Bonds 75.6%」等。
"""
import json
import os
import re
import sys
import time

import pdfplumber

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF = os.path.join(BASE, "tmp", "bocom_ffs.pdf")
ASOF = "2026-06-30"


def parse_page(t, pg=None):
    m = re.search(r"(交通銀行[\u4e00-\u9fff]+?)(?:成分)?基金", t)
    name = m.group(1) + "成分基金" if m else None
    top10 = []
    # 坐标法：序号 x≈387、名称 390-515、权重 x≈532
    if pg is not None:
        words = pg.extract_words(x_tolerance=3)
        ty = None
        for w in words:
            if "十大" in w["text"]:
                ty = w["top"]
                break
        if ty is not None:
            rows = {}
            for w in words:
                if ty - 3 <= w["top"] <= ty + 165:
                    rows.setdefault(round(w["top"]), []).append(w)
            for k in sorted(rows):
                ws = sorted(rows[k], key=lambda w: w["x0"])
                if not any(re.match(r"^\d{1,2}\.$", w["text"]) and 380 <= w["x0"] <= 395 for w in ws):
                    continue
                pcts = [w for w in ws if 522 <= w["x0"] <= 550 and re.match(r"^\d+(\.\d+)?%?$", w["text"])]
                if not pcts:
                    continue
                nm = " ".join(w["text"] for w in ws if 390 <= w["x0"] < 520)
                if nm:
                    nm = re.sub(r"^\d{1,2}\.\s*", "", nm)
                    top10.append({"name": nm[:60], "weight": float(pcts[0]["text"].rstrip("%"))})
                if len(top10) >= 10:
                    break
    if len(top10) < 3:
        # 兜底：文本正则
        top10 = []
        i = t.find("十大資產")
        if i < 0:
            i = t.find("Top 10 Holdings")
        if i >= 0:
            seg = t[i:i + 1600]
            for l in seg.split("\n"):
                m2 = re.match(r"^(\d{1,2})\.\s*(.+?)\s+(\d+\.\d+)%\s*$", l.strip())
                if m2:
                    top10.append({"name": re.sub(r"^\d{1,2}\.\s*", "", m2.group(2).strip())[:52], "weight": float(m2.group(3))})
                if len(top10) >= 10:
                    break
    # 资产分布：中文 + 百分比（行内可能英文名夹在中间）
    alloc = []
    for m3 in re.finditer(r"([\u4e00-\u9fff]{2,10})\s*(?:[A-Za-z][A-Za-z /&\.]*)?\s+(\d+\.\d+)%", t):
        lbl = m3.group(1)
        if any(k in lbl for k in ("基金", "股票", "債券", "現金", "地區", "其他")) and len(alloc) < 12:
            if all(a["label"] != lbl for a in alloc):
                alloc.append({"label": lbl, "weight": float(m3.group(2))})
    return name, top10, alloc


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else PDF
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    bc = [x for x in FN if "交通" in (x.get("trustee") or "") or "交通" in (x.get("scheme") or "")]
    pdf = pdfplumber.open(path)
    ok = 0
    for pg in pdf.pages:
        t = pg.extract_text() or ""
        name, top10, alloc = parse_page(t, pg)
        if not top10 or not name:
            continue
        core = name.replace("交通銀行", "").replace("成分基金", "").replace("基金", "").strip()
        x = None
        for v in bc:
            fb = (v.get("fundBase") or v.get("fund") or "")
            if core and core in fb:
                x = v
                break
        if not x:
            print("✘ 未匹配:", name, "core=", core)
            continue
        hld["funds"][str(x["id"])] = {
            "asOf": ASOF,
            "src": "交通銀行信託基金便覽 PDF（FFS 2026Q2）",
            "top10": top10,
            "alloc": alloc,
            "allocLabel": "資產分佈" if alloc else None,
        }
        ok += 1
        print("✔ #%s %s top10=%d alloc=%d" % (x["id"], name[:22], len(top10), len(alloc)))
    pdf.close()
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
