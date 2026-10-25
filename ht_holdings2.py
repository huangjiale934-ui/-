# -*- coding: utf-8 -*-
"""海通持仓重解析 v2（ht_holdings2.py）—— 汇总 PDF 坐标级解析
====================================================================
2026-10-18 重写。教训：海通 7 个「概覽」URL 全部返回**同一份 6 页汇总 PDF**
（md5 相同），且仅 p3-p6 含 4 只基金的 TOP TEN / ASSET ALLOCATION
（香港特區 / 環球分散 / 65歲後 / 保守）；亞太 / 韓國 / 核心累積官方 PDF
不披露持仓 → 不写数据（前端显示「官方未披露」），绝不再错乱套页。

坐标规律（pdfplumber extract_words）：
- 页边免责声明/表现表格：x0 < 280
- TOP TEN 行：名称词 x0 ≈ 284-380，百分比 x ≈ 480-495
- ASSET ALLOCATION 行：名称词 x ≈ 290-340，百分比 x ≈ 350-500
- 标题定位：「TOP TEN HOLDINGS」词 TEN 的 top；「ASSET ALLOCATION」词 ASSET 的 top
- asOf：「Issue Price as of 31/08/2026」→ 2026-08-31
"""
import json
import os
import re

import pdfplumber

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF = os.path.join(BASE, "tmp", "ht_pdf2", "Haitong_Korea_Fund.pdf")  # 7 个 URL 同一文件

# 页 → 基金名核心（p3-p6，0-based index 2-5）
PAGE2CORE = {
    2: "香港特區",
    3: "環球分散",
    4: "65歲後",
    5: "強積金保守",
}


def page_fund_name(words):
    for w in words:
        if re.match(r"^海通[\u4e00-\u9fff0-9]+基金", w["text"]):
            return w["text"].rstrip("*")
    return None


def page_asof(words):
    for i, w in enumerate(words):
        if w["text"] == "of" and i + 1 < len(words) and re.match(r"^\d{2}/\d{2}/\d{4}$", words[i + 1]["text"]):
            d = words[i + 1]["text"]
            return "%s-%s-%s" % (d[6:10], d[3:5], d[0:2])
    return None


def group_rows(words, y0, y1):
    rows = {}
    for w in words:
        if y0 <= w["top"] <= y1:
            k = round(w["top"])
            rows.setdefault(k, []).append(w)
    return [sorted(v, key=lambda x: x["x0"]) for k, v in sorted(rows.items())]


def clean_hold_name(name):
    """清理持仓名称：剥掉存款利率列（2.6500%△08-10-2026※）、日期后缀"""
    name = re.split(r"[△※]", name)[0]
    name = re.sub(r"\s+\d{1,2}-\d{1,2}-\d{4}.*$", "", name).strip()
    name = re.sub(r"\s+\d+(\.\d+)?%$", "", name).strip()
    return name


def anchor_rows(words, x_pct_min, x_pct_max, x_name_min, x_name_max, y_lo, y_hi, y_up, y_down, allow_pct=False):
    """锚点法：百分比词为锚点（限 y 区间），名称取其 y 邻域内 x 区间的词。"""
    pct_re = re.compile(r"^\d+(\.\d+)?%?$") if allow_pct else re.compile(r"^\d+(\.\d+)?$")
    out = []
    used = set()
    for pw in words:
        if not pct_re.match(pw["text"]):
            continue
        if not (x_pct_min <= pw["x0"] <= x_pct_max) or not (y_lo <= pw["top"] <= y_hi):
            continue
        y = pw["top"]
        name_w = [w for w in words
                  if x_name_min <= w["x0"] < x_name_max
                  and y - y_up <= w["top"] <= y + y_down
                  and not re.match(r"^\d+(\.\d+)?$", w["text"])]
        key = tuple(sorted((w["text"], round(w["x0"]), round(w["top"])) for w in name_w))
        if key in used:
            continue
        used.add(key)
        name = clean_hold_name(" ".join(w["text"] for w in sorted(name_w, key=lambda w: (round(w["top"]), w["x0"]))).strip())
        if not name or len(name) < 2 or not re.search(r"[A-Za-z]{2}|[\u4e00-\u9fff]", name):
            continue
        out.append({"name": name, "weight": float(pw["text"].rstrip("%"))})
    return out


def parse_top10(words, ty):
    """TOP TEN：y∈[ty+18, ty+180]，百分比 x∈[460,520]；名称词 x∈[280,460)，y 邻域 [-5,+2]"""
    rows = anchor_rows(words, 460, 520, 280, 460, ty + 18, ty + 180, 5, 2)
    rows.sort(key=lambda r: -r["weight"])
    return [{"name": r["name"], "weight": r["weight"]} for r in rows][:10]


BAD_NAME_WORDS = re.compile(
    r"基金表現|年度化回報率|類別|基金回報|每公曆|自成立起|年初至今|組合資產|最高股票比重|"
    r"不適用|N/?A|年年|資產分佈|ASSET|ALLOCATION|TOPTEN|HOLDINGS|Issue|Price|Class|"
    r" Constituent|Approved|Pooled|Fees|charges|Past|performance")


def parse_alloc(words, ty):
    """ASSET ALLOCATION（条形图布局）：锚点法。每个百分比词（须含小数点、带%或x>=365、x>=280）
    的名称 = 其 y 邻域 [-8,+6] 内 x∈[280,365) 的非数字非表格词（兼容「同行」与「跨行」两种布局）。"""
    zone = [w for w in words if ty + 8 <= w["top"] <= ty + 185]
    num_re = re.compile(r"^\d+(\.\d+)?%?$")
    pct_re = re.compile(r"^\d+\.\d+%?$")
    out = []
    for pw in zone:
        if not (pct_re.match(pw["text"]) and ("%" in pw["text"] or pw["x0"] >= 365) and pw["x0"] >= 280):
            continue
        y = pw["top"]
        nw = [w for w in zone
              if 280 <= w["x0"] < 365 and y - 8 <= w["top"] <= y + 6
              and not num_re.match(w["text"]) and "%" not in w["text"]
              and not BAD_NAME_WORDS.search(w["text"])]
        if not nw:
            continue
        zh = "".join(w["text"] for w in sorted(nw, key=lambda w: w["x0"]) if re.search(r"[\u4e00-\u9fff]", w["text"]))
        en = "".join(w["text"] for w in sorted(nw, key=lambda w: w["x0"]) if not re.search(r"[\u4e00-\u9fff]", w["text"]))
        nm = (zh or en).strip()
        if not nm or len(nm) < 2 or len(nm) > 12:
            continue
        out.append({"label": nm, "weight": float(pw["text"].rstrip("%"))})
    bad = re.compile(r"TOPTEN|HOLDINGS|持股|ASSET|ALLOCATION|回報|年年|類別", re.I)
    return [x for x in out if not bad.search(x["label"])]


def _alloc_name(pre_buf, post_buf):
    def zh(buf):
        return "".join(w["text"] for w in sorted(buf, key=lambda w: w["x0"]) if re.search(r"[\u4e00-\u9fff]", w["text"])).strip()
    def en(buf):
        return "".join(w["text"] for w in sorted(buf, key=lambda w: w["x0"]) if not re.search(r"[\u4e00-\u9fff]", w["text"])).strip()
    nm = zh(post_buf) or zh(pre_buf) or en(post_buf) or en(pre_buf)
    return nm if nm and len(nm) >= 2 else None


def main():
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    pdf = pdfplumber.open(PDF)
    # 清掉旧的海通错乱数据
    removed = 0
    for fid in list(hld["funds"].keys()):
        x = next((f for f in FN if str(f["id"]) == fid), None)
        if x and "海通" in (x.get("scheme") or ""):
            del hld["funds"][fid]
            removed += 1
    added = 0
    for pi, core in PAGE2CORE.items():
        pg = pdf.pages[pi]
        words = pg.extract_words(x_tolerance=8)
        nm = page_fund_name(words)
        asof = page_asof(words)
        # 标题定位
        ty10 = None
        tyal = None
        alloc_label = "資產分佈"
        for i, w in enumerate(words):
            if w["text"] == "TEN" and ty10 is None:
                ty10 = w["top"]
            if w["text"] == "ASSET" and tyal is None:
                tyal = w["top"]
        if tyal is not None:
            for row in group_rows(words, tyal - 8, tyal + 14):
                txt = " ".join(w["text"] for w in row)
                m = re.search(r"\((BY [A-Z/ ]+)\)", txt)
                if m:
                    alloc_label = "資產分佈（%s）" % m.group(1).strip().title()
                if "資產分佈" in txt and "(" in txt:
                    m2 = re.search(r"資產分佈\(([^)]+)\)", txt)
                    if m2:
                        raw = m2.group(1)
                        alloc_label = "資產分佈（%s）" % (
                            "國家/地區" if "Country" in raw or "REGION" in raw.upper()
                            else "行業" if "Sector" in raw.title() or "SECTOR" in raw.upper()
                            else raw)
        top10 = parse_top10(words, ty10) if ty10 is not None else []
        alloc = parse_alloc(words, tyal) if tyal is not None else []
        print("p%d %s asOf=%s TOP TEN=%d ALLOC=%d (%s)" % (pi + 1, nm, asof, len(top10), len(alloc), alloc_label))
        for t in top10:
            print("   top10:", t["name"][:46], t["weight"])
        for a in alloc[:12]:
            print("   alloc:", a["label"], a["weight"])
        if not top10 and not alloc:
            print("   （无持仓数据）")
            continue
        for x in [f for f in FN if "海通" in (f.get("scheme") or "") and core in (f.get("fundBase") or f.get("fund"))]:
            hld["funds"][str(x["id"])] = {
                "asOf": asof,
                "src": "海通國際基金概覽 PDF（彙總版，季度）",
                "top10": top10,
                "alloc": alloc,
                "allocLabel": alloc_label,
            }
            added += 1
    pdf.close()
    hld["count"] = len(hld["funds"])
    hld["source"] = "宏利官网基金详情（季度） + 友邦 FPR 月刊（月末） + 海通國際基金概覽 PDF（季度） + BCT 景順系 Fact Sheet"
    hld["updatedAt"] = int(__import__("time").time() * 1000)
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：删除旧海通 %d 条，写入 %d 条；holdings 共 %d 只" % (removed, added, hld["count"]))


if __name__ == "__main__":
    main()
