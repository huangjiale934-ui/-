# -*- coding: utf-8 -*-
"""海通持仓重解析 v3（ht_holdings3.py）—— 修正「一页两只基金」与标题缺失
====================================================================
真相（2026-10-18 深挖）：
  6 页汇总 PDF 实际含 **7 只基金**：p3=香港特區(上半)+亞太(下半，标题缺失)、
  p4=環球分散+韓國、p5=65歲後+核心累積、p6=強積金保守。
  每页 2 个「TOP TEN HOLDINGS」区块（y≈210-250 上半 / y≈580-635 下半）；
  标题字号 12（y≈30 顶部 + y≈396 中部）；p3 中部标题被压（缺失）→ 用持仓内容推断。
  旧版按 extract_text 首行命名 → 8 条数据全部错配，已废弃。
"""
import json
import os
import re
import time
from collections import defaultdict

import pdfplumber

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF = os.path.join(BASE, "tmp", "ht_pdf3", "Haitong_Korea_Fund.pdf")

# 规范名 → 清单匹配核心
NAME_MAP = {
    "海通香港特區基金": "香港特區",
    "海通亞太基金": "亞太",
    "海通環球分散基金": "環球分散",
    "海通韓國基金": "韓國",
    "海通65歲後基金": "65歲後",
    "海通核心累積基金": "核心累積",
    "海通強積金保守基金": "強積金保守",
}


def page_titles(pg):
    """返回 [(y, 规范中文基金名)]"""
    chars = [c for c in pg.chars if c["size"] >= 11.3]
    rows = defaultdict(str)
    for c in chars:
        rows[round(c["top"])] += c["text"]
    out = []
    for y in sorted(rows):
        s = rows[y]
        if "基金" in s and "Fund" not in s:
            nm = s.replace("*", "").replace(" ", "").strip()
            out.append((y, nm))
    return out


def parse_block(words, ty):
    """解析一个 TOP TEN 区块：名称词 x<460（剔除脚注 ^/**），百分比 x∈[460,520]"""
    zone = [w for w in words if ty + 14 <= w["top"] <= ty + 175]
    rows = defaultdict(list)
    for w in zone:
        rows[round(w["top"])].append(w)
    top10 = []
    for k in sorted(rows):
        ws = sorted(rows[k], key=lambda w: w["x0"])
        pcts = [w for w in ws if 455 <= w["x0"] <= 530 and re.match(r"^\d+\.\d+$", w["text"])]
        if not pcts:
            continue
        # 名称：邻域 k±3、x<455 的英文/中文词（剔除 ^ ** ▲ 等）
        parts = []
        for k2 in (k - 3, k - 2, k - 1, k, k + 1, k + 2):
            for w in rows.get(k2, []):
                if 280 <= w["x0"] < 455 and not re.match(r"^[\d\.\^%]+$", w["text"]):
                    tx = w["text"].replace("^", "").replace("*", "").strip()
                    if tx and tx not in parts:
                        parts.append(tx)
        nm = " ".join(parts).strip()
        if not nm or len(nm) < 2:
            continue
        top10.append({"name": nm[:46], "weight": float(pcts[0]["text"])})
        if len(top10) >= 10:
            break
    return top10


def guess_by_content(top10):
    """内容特征推断基金（用于标题缺失的区块）"""
    txt = " ".join(t["name"].lower() for t in top10)
    if "hynix" in txt or "samsung" in txt:
        # SK hynix 高权重 → 韩国；低权重 + 台达/Advantest → 亚太
        h = [t["weight"] for t in top10 if "hynix" in t["name"].lower()]
        if h and h[0] >= 5:
            return "海通韓國基金"
        return "海通亞太基金"
    if "treasury" in txt or "bund" in txt or "govt" in txt or "bond" in txt:
        return "海通65歲後基金"
    return None


def main():
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ht = [x for x in FN if "海通" in (x.get("scheme") or "")]
    pdf = pdfplumber.open(PDF)
    results = []  # (规范名, top10)
    for pi in range(len(pdf.pages)):
        pg = pdf.pages[pi]
        titles = page_titles(pg)
        words = pg.extract_words(x_tolerance=3)
        tys = sorted(set(round(w["top"]) for w in words if w["text"] in ("TOP", "Top")))
        if not tys:
            continue
        blocks = [(ty, parse_block(words, ty)) for ty in tys]
        blocks = [(ty, b) for ty, b in blocks if len(b) >= 3]
        print("p%d 标题=%s 区块=%s" % (pi + 1, [n for _, n in titles], [len(b) for _, b in blocks]))
        for bi, (ty, b) in enumerate(blocks):
            nm = None
            if bi < len(titles):
                nm = titles[bi][1]
            elif len(titles) >= 1 and bi >= len(titles):
                nm = guess_by_content(b)
                print("  区块%d 标题缺失 → 内容推断: %s（首行 %s %.2f）" % (bi + 1, nm, b[0]["name"][:20], b[0]["weight"]))
            if nm:
                results.append((nm, b))
    pdf.close()
    # 写入（A/T 共享同一持仓）
    ok = 0
    for nm, top10 in results:
        core = NAME_MAP.get(nm)
        if not core:
            print("✘ 未映射:", nm)
            continue
        mine = [x for x in ht if core in (x.get("fundBase") or x.get("fund") or "")]
        if not mine:
            print("✘ 清单无此基金:", nm)
            continue
        for x in mine:
            hld["funds"][str(x["id"])] = {
                "asOf": "2026-08-31",
                "src": "海通國際基金概覽 PDF（2026-08，逐基金頁）",
                "top10": top10,
                "alloc": [],
                "allocLabel": None,
            }
            ok += 1
        print("✔ %s → %d 条（top10=%d，首行 %s %.2f）" % (nm, len(mine), len(top10), top10[0]["name"][:22], top10[0]["weight"]))
    hld["count"] = len(hld["funds"])
    hld["updatedAt"] = int(time.time() * 1000)
    srcs = set()
    for v in hld["funds"].values():
        if v.get("src"):
            srcs.add(v["src"].split("（")[0])
    hld["source"] = " + ".join(sorted(srcs))
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：写入 %d 条；holdings 共 %d" % (ok, hld["count"]))


if __name__ == "__main__":
    main()
