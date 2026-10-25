# -*- coding: utf-8 -*-
"""永明持仓解析（sunlife_holdings.py）—— PyMuPDF 分离隐藏层
====================================================================
用户指正（2026-10-19）：`SLR_MPF_Quarterly_Update.pdf` 的持仓区**确实可解析**，
问题在于 pdfplumber 把 PDF 的两层文字（隐藏层+可见层）全部提取导致逐字交错。
**PyMuPDF (fitz) 只取可见层**，文本顺序清晰：
    十大主要證券 / 7 Top 10 Holdings / 1.9% / OCBC Wing Hang Bank Limited 2.52% 7 Aug 2026 / ...
即「权重行（x.x%）+ 名称行（名称 利率 到期日）」交替。
用法：python sunlife_holdings.py tmp/slr_mpf.pdf
"""
import json
import os
import re
import sys
import time

import pymupdf

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "tmp", "slr_mpf.pdf")


def norm(s):
    return re.sub(r"[\s\-（）()【】\[\]·、]", "", s or "").replace("強積金", "").replace("基金", "")


def parse_page(t):
    """返回 (基金名, asof, top10, alloc)"""
    name = None
    for l in t.split("\n"):
        m = re.match(r"^(永明[\u4e00-\u9fffA-Za-z0-9 ]+?基金)\s*$", l.strip())
        if m:
            name = m.group(1).strip()
            break
    asof = None
    m = re.search(r"截至\s*As at\s*(\d{2})/(\d{2})/(\d{4})", t)
    if m:
        asof = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    # Top 10：权重行 + 名称行 交替
    top10 = []
    i = t.find("十大主要證券")
    if i >= 0:
        tail = t[i:i + 1500]
        lines = [l.strip() for l in tail.split("\n") if l.strip()]
        j = 0
        while j < len(lines) - 1:
            mw = re.match(r"^(\d+(?:\.\d+)?)%$", lines[j])
            if mw:
                nm_line = lines[j + 1]
                # 名称：去掉尾部「利率 日期」；取英文/中文主体
                nm = re.sub(r"\s+\d+(\.\d+)?\s*%?.*$", "", nm_line).strip()
                nm = re.sub(r"\s+CD\s*$", "", nm).strip()
                if nm and 2 <= len(nm) <= 70:
                    top10.append({"name": nm, "weight": float(mw.group(1))})
                j += 2
            else:
                j += 1
            if len(top10) >= 10:
                break
    # Portfolio Allocation：饼图标签（名称 + 百分比，顺序不定）
    alloc = []
    k = t.find("投資組合分布")
    if k >= 0:
        seg = t[k:k + 260]
        for m2 in re.finditer(r"([\u4e00-\u9fff][\u4e00-\u9fffA-Za-z &/]*?)\s*(\d+\.\d)%", seg):
            lbl = m2.group(1).strip()
            if 2 <= len(lbl) <= 16 and all(a["label"] != lbl for a in alloc):
                alloc.append({"label": lbl, "weight": float(m2.group(2))})
    return name, asof, top10, alloc


def main():
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ym = [x for x in FN if "永明" in (x.get("trustee") or "")]
    byname = {}
    for f in ym:
        byname[norm(f.get("fundBase") or f.get("fund") or "")] = f
    doc = pymupdf.open(PDF)
    ok = 0
    for pi in range(len(doc)):
        t = doc[pi].get_text("text")
        if "十大主要證券" not in t and "Top 10 Holdings" not in t:
            continue
        name, asof, top10, alloc = parse_page(t)
        if not name or len(top10) < 3:
            continue
        k = norm(name)
        x = byname.get(k)
        if not x:
            # 容错：包含匹配
            cands = [v for kk, v in byname.items() if kk and (kk in k or k in kk)]
            x = cands[0] if cands else None
        if not x:
            print("✘ p%d 未匹配: %s" % (pi + 1, name))
            continue
        old = hld["funds"].get(str(x["id"]))
        force = "--force" in sys.argv
        if not force and old and len(old.get("top10") or []) >= len(top10) and old.get("alloc"):
            print("· p%d #%s %s 已有更完整数据，跳过" % (pi + 1, x["id"], name[:16]))
            continue
        if force and old and len(old.get("top10") or []) > len(top10):
            print("· p%d #%s %s 原数据更全，跳过" % (pi + 1, x["id"], name[:16]))
            continue
        new_rec = {
            "asOf": asof,
            "src": "永明彩虹強積金計劃季報 PDF（SLR，季度）",
            "top10": top10,
            "alloc": alloc,
            "allocLabel": "投資組合分佈" if alloc else None,
        }
        # 2026-10-24 防退化：舊記錄 alloc 項數更多時保留（SLR 部分頁的餅圖解析不出，曾清空 22 條）
        if old and len(old.get("alloc") or []) > len(alloc):
            new_rec["alloc"] = old["alloc"]
            new_rec["allocLabel"] = old.get("allocLabel")
            for k in ("allocSum", "allocIncomplete", "allocTitle", "allocSrc"):
                if k in old:
                    new_rec[k] = old[k]
        hld["funds"][str(x["id"])] = new_rec
        ok += 1
        print("✔ p%d #%s %s top10=%d alloc=%d asOf=%s" % (
            pi + 1, x["id"], name[:18], len(top10), len(alloc), asof), flush=True)
    # --force：同基金多单位类别（A/B 類）共用同一投資組合 → 複製
    if "--force" in sys.argv:
        pool = [x for x in FN if "永明" in (x.get("scheme") or "")]
        base_of = {}
        for f in pool:
            base_of.setdefault(norm(f.get("fundBase") or ""), []).append(f)
        for base, grp in base_of.items():
            if len(grp) < 2:
                continue
            full = [g for g in grp if len((hld["funds"].get(str(g["id"])) or {}).get("top10") or []) == 10]
            if not full:
                continue
            src_rec = hld["funds"][str(full[0]["id"])]
            for g in grp:
                cur = hld["funds"].get(str(g["id"])) or {}
                if str(g["id"]) == str(full[0]["id"]) or len(cur.get("top10") or []) >= 10:
                    continue
                new = json.loads(json.dumps(src_rec))
                new["src"] = src_rec["src"] + "（%s 類單位共用同一投資組合）" % (g.get("unit") or "")
                hld["funds"][str(g["id"])] = new
                ok += 1
                print("✔ 同組合複製 #%s %s" % (g["id"], (g.get("fundBase") or "")[:20]), flush=True)
    doc.close()
    hld["count"] = len(hld["funds"])
    hld["updatedAt"] = int(time.time() * 1000)
    srcs = set()
    for v in hld["funds"].values():
        if v.get("src"):
            srcs.add(v["src"].split("（")[0])
    hld["source"] = " + ".join(sorted(srcs))
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：写入 %d；holdings 共 %d" % (ok, hld["count"]))


if __name__ == "__main__":
    main()
