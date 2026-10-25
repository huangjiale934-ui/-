# -*- coding: utf-8 -*-
"""中银保诚持仓解析（bocpt_holdings.py）—— 季度基金便览 PDF（26 页全基金）
====================================================================
PDF: https://www.bocpt.com/media/2718/my-choice-fund-factsheet-2q26.pdf（我的強積金計劃）
     另有 easy-choice 版 dis_ec_dpn_c.pdf
结构：每页一只基金；页眉「我的XX基金 / MY CHOICE XX FUND」+「截至 As at 30/6/2026」；
     TOP TEN：行首序号 + 中英文名 + 百分比；ASSET ALLOCATION BY INDUSTRIES：行业行（部分文字流乱，只取清晰行）。
"""
import json
import os
import re
import sys
import time

import pdfplumber
from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF = os.path.join(BASE, "tmp", sys.argv[1] if len(sys.argv) > 1 else "bocpt_fs.pdf")
SRC_MAP = {"bocpt_fs.pdf": "我的強積金計劃", "bocpt_ec2.pdf": "簡易強積金計劃"}
SRC_URL = "https://www.bocpt.com/media/2718/my-choice-fund-factsheet-2q26.pdf"


def parse_page(pg, t):
    """提取单页：基金名 / top10（坐标法+文本法）/ alloc（文本法）。兼容两种版式：
    A. 我的強積金計劃（双栏：中文名行 x=30 + 英文行 x=20）
    B. 簡易強積金計劃（单行：序号 英文名 中文名 百分比）"""
    lines = t.split("\n")
    name = None
    for l in lines[:8]:
        m = re.match(r"^(我的[\u4e00-\u9fffA-Za-z0-9（）()]+基金|中銀保誠[\u4e00-\u9fffA-Za-z0-9]+基金|[\u4e00-\u9fff]+基金)", l.strip())
        if m:
            name = m.group(1)
            break
    if not name:
        for l in lines[:8]:
            if re.search(r"基金", l) and not re.search(r"便覽|Fact Sheet|時，若", l):
                name = l.strip()
                break
    if name:
        name = re.sub(r"[\s（(]?續[\s）)]?$", "", name).strip()
        name = name.rstrip("^#◆ ").strip()
        # 去掉英文后缀（中銀保誠中國股票基金◆ BOC-Prudential China Equity…）与描述尾巴
        name = re.split(r"\s{2,}|◆|\s+BOC|為一股票基金|為一", name)[0].strip()
    asof = None
    m = re.search(r"截至\s*(?:As at\s*)?(\d{1,2})/(\d{1,2})/(\d{4})", t)
    if m:
        asof = "%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1)))
    if not asof:
        # 简易计划版无「截至」行：按季度封底推断（如 2Q26 → 2026-06-30）
        q = re.search(r"(\d)(?:st|nd|rd|th)\s*Quarter", t)
        y = re.search(r"20(2\d)", t)
        if q and y:
            qq = int(q.group(1))
            asof = "%s-%02d-%02d" % ("20" + y.group(1), qq * 3, [31, 30, 30, 31][qq - 1])
    # TOP TEN 文本法（B 版式单行；A 版式兜底）：序号 + 名称 + 百分比
    top10_txt = []
    i = t.find("Top Ten Holdings")
    if i < 0:
        i = t.find("TOP TEN HOLDINGS")
    if i < 0:
        i = t.find("十大資產項目")
    if i >= 0:
        seg = t[i:i + 3000]
        for l in seg.split("\n"):
            if "投資附帶風險" in l or "Investment involves risks" in l:
                break
            m = re.match(r"^(\d{1,2})\s+(.+?)\s+(\d+\.\d+)%\s*$", l.strip())
            if m:
                nm = m.group(2).strip()
                # B 版式：英文名 + 中文名 → 取中文尾部
                cjk = re.findall(r"[\u4e00-\u9fff][\u4e00-\u9fffA-Za-z0-9（）()\-\.]*", nm)
                if cjk:
                    nm2 = cjk[-1]
                else:
                    nm2 = nm
                if len(nm2) >= 2:
                    top10_txt.append({"name": nm2, "weight": float(m.group(3))})
            if len(top10_txt) >= 10:
                break
    # TOP TEN 坐标法（A 版式双栏）
    top10 = []
    try:
        words = pg.extract_words(x_tolerance=3)
        ty = None
        is_ec = False
        for w in words:
            if w["text"] == "Top":
                is_ec = True
        for w in words:
            if w["text"] in ("TEN", "Ten"):
                ty = w["top"]
                break
        # 版式参数：fs（我的计划，双栏）pct x∈[315,350]、名称 x<300、邻域 ±2；
        # ec（简易计划，单行）pct x∈[520,585]、名称 280-530、邻域 ±3
        pct_lo, pct_hi = (520, 585) if is_ec else (315, 350)
        nm_lo, nm_hi = (280, 530) if is_ec else (0, 300)
        span = (-3, -1, 0, 1, 2, 3) if is_ec else (-1, 0, 1, 2)
        if ty is not None:
            zone = [w for w in words if ty - 2 <= w["top"] <= ty + 150]
            pct_rows = {}
            for w in zone:
                k = round(w["top"])
                pct_rows.setdefault(k, []).append((w["x0"], w["text"]))
            for k, ws in sorted(pct_rows.items()):
                ws.sort()
                pcts = [x for x in ws if re.match(r"^\d+(\.\d+)?%$", x[1]) and pct_lo <= x[0] <= pct_hi]
                if not pcts:
                    continue
                w_pct = float(pcts[0][1].rstrip("%"))
                zh = ""
                en_raw = ""
                for k2 in span:
                    for x0, tx in pct_rows.get(k + k2, []):
                        if nm_lo <= x0 < nm_hi and not re.match(r"^\d+(\.\d+)?%?$", tx):
                            if re.search(r"[\u4e00-\u9fff]", tx):
                                zh += tx
                zh = zh.strip()
                nm = zh
                if not nm:
                    en = " ".join(tx for x0, tx in ws if nm_lo <= x0 < nm_hi and not re.match(r"^\d+(\.\d+)?%?$", tx))
                    en = re.sub(r"\((?:POST SPLIT|REGD|REGS|HK|A|B)\)", "", en)
                    en = re.sub(r"(?:EUR|CHF|USD|GBP|HKD|JPY|SGD|AUD|CAD|CNY|RMB)[\d\.]+", "", en)
                    en = re.sub(r"\s+", " ", en).strip(" -")
                    nm = en
                if nm:
                    top10.append({"name": nm, "weight": w_pct})
                if len(top10) >= 10:
                    break
    except Exception:
        pass
    # 取更优者：坐标法不足 5 项时用文本法
    if len(top10) < 5 and len(top10_txt) > len(top10):
        top10 = top10_txt
    # ASSET ALLOCATION：清晰行「中文行业 English xx.xx%」或「行业名 xx.xx%」
    alloc = []
    i2 = t.find("ASSET ALLOCATION")
    if i2 >= 0:
        seg = t[i2:i2 + 900]
        for l in seg.split("\n"):
            m = re.search(r"([\u4e00-\u9fff]{2,8}(?:[\u4e00-\u9fff]{0,6})?)\s+[A-Za-z][A-Za-z\s&\.]{2,40}\s+(\d+\.\d+)%", l)
            if m:
                alloc.append({"label": m.group(1), "weight": float(m.group(2))})
            else:
                m2 = re.search(r"^([\u4e00-\u9fff]{2,10})\s+(\d+\.\d+)%", l.strip())
                if m2 and "現金" not in m2.group(1) or (m2 and "現金" in m2.group(1)):
                    if m2:
                        alloc.append({"label": m2.group(1), "weight": float(m2.group(2))})
        # 去重
        seen = set()
        alloc2 = []
        for a in alloc:
            if a["label"] not in seen:
                seen.add(a["label"])
                alloc2.append(a)
        alloc = alloc2
    return name, asof, top10, alloc


def main():
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    mine = {x.get("fundBase") or x.get("fund"): x for x in FN if "中銀保誠" in (x.get("trustee") or "")}
    pdf = pdfplumber.open(PDF)
    ok = 0
    for pi, pg in enumerate(pdf.pages):
        t = pg.extract_text() or ""
        name, asof, top10, alloc = parse_page(pg, t)
        if not name or not top10:
            if top10:
                print("p%d %s：top10 %d alloc %d（无基金名）" % (pi + 1, name, len(top10), len(alloc)))
            continue
        # 匹配我们的清单：「我的香港股票基金」→「香港股票基金」
        x = mine.get(name)
        if not x:
            core = name.replace("我的", "")
            for k, v in mine.items():
                if core in k or k.replace("中銀保誠", "") == core:
                    x = v
                    break
        if not x:
            print("✘ p%d %s：未匹配清单" % (pi + 1, name))
            continue
        hld["funds"][str(x["id"])] = {
            "asOf": asof or "2026-06-30",
            "src": "中銀保誠「%s」季度基金便覽 PDF（2Q26）" % SRC_MAP.get(os.path.basename(PDF), "基金便覽"),
            "top10": top10,
            "alloc": alloc,
            "allocLabel": "資產分佈（行業）" if alloc else None,
        }
        ok += 1
        print("✔ #%s %s top10=%d alloc=%d asOf=%s" % (x["id"], name[:18], len(top10), len(alloc), asof))
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
