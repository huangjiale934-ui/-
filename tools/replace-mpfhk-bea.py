# -*- coding: utf-8 -*-
"""東亞 15 只 mpf.hk 轉載換源（tools/replace-mpfhk-bea.py）
====================================================================
背景：東亞（行業 12 + 集成 2 + 享惠 1）的 top10/src 仍標 mpf.hk 轉載；
      官方 FFS PDF（bea_ffs.pdf，截至 2026-06-30，官網最新期，Q3 未發佈）每頁含兩個 Top 區塊。

做法：復用 bea_holdings.py 的區塊解析（y 坐標切塊）+ 計劃/基金匹配；
      --force 覆蓋 top10/src/asOf；alloc 保留原值（官方 alloc 為環形圖無文字層，
      alloc_generic 只能解析 1-3 項，覆蓋會退化，故不動）。

用法：python tools/replace-mpfhk-bea.py [pdf] --write
"""
import json
import os
import re
import sys
import time

import pdfplumber

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
from bea_holdings import parse_block, KWS  # noqa: E402

HOLD = os.path.join(BASE, "data", "holdings.json")
PDF = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else \
    os.path.join(os.path.dirname(BASE), "mpf-app-tmp-archive", "2026-10-19", "bea_ffs.pdf")
WRITE = "--write" in sys.argv
ASOF = "2026-06-30"
SRC = "東亞銀行基金概覽 PDF（FFS 2026Q2）"

# 目標 15 只（mpf.hk 轉載 → 官方 FFS）
TARGETS = {"212", "213", "214", "215", "811", "812", "899", "900", "901", "913",
           "1535", "1536", "897", "898", "1047"}


def main():
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(BASE, "data", "funds.json"), encoding="utf-8"))["funds"]
    # 只在東亞目標名單內匹配
    ea = [x for x in FN if str(x["id"]) in TARGETS]
    plan = "集成信託"
    pdf = pdfplumber.open(PDF)
    ok, seen = 0, {}
    for pi, pg in enumerate(pdf.pages):
        t = pg.extract_text() or ""
        if "Value Scheme" in t:
            plan = "享惠"
        if "Industry Scheme" in t and "Remarks" not in t:
            plan = "行業"
        words = pg.extract_words(x_tolerance=3)
        tys = sorted(set(round(w["top"]) for w in words if w["text"] == "Top"))
        if not tys:
            continue
        names = []
        for l in t.split("\n"):
            m = re.search(r"BEA (?:\(MPF\) |\()?(?:\(Industry Scheme\) )?([A-Za-z0-9 &\-()]+?)\)? Fund", l)
            if m:
                nm = m.group(1).strip()
                if not names or names[-1][1] != nm:
                    names.append((len(names), nm))
        page_h = max(w["top"] for w in words) if words else 800
        for bi, ty in enumerate(tys):
            y_end = min((tys[bi + 1] - 4) if bi + 1 < len(tys) else ty + 130, ty + 130, page_h)
            if bi < len(names):
                en = names[bi][1]
            elif names:
                en = names[-1][1]
            else:
                continue
            top10 = parse_block(words, ty, y_end)
            if len(top10) < 3:
                continue
            kw = next((v for k, v in KWS if k.lower() in en.lower()), None)
            if not kw:
                print("✘ p%d 無關鍵詞: %s" % (pi + 1, en))
                continue
            cand = [x for x in ea if plan in (x.get("scheme") or "")] or ea
            x = next((v for v in cand if kw in (v.get("fundBase") or "")), None)
            if not x:
                # 追蹤指數類：名稱不含 KWS 直接詞（China Tracker/Hong Kong Tracker 在 KWS 中）
                x = next((v for v in cand if "追蹤" in (v.get("fundBase") or "")
                          and ("Tracker" in en or "追蹤" in kw)), None)
            if not x:
                print("✘ p%d 未匹配: [%s] %s → %s" % (pi + 1, plan, en, kw))
                continue
            fid = str(x["id"])
            if fid in seen:
                continue
            seen[fid] = True
            rec = hld["funds"].setdefault(fid, {})
            rec["asOf"] = ASOF
            rec["top10"] = top10
            rec["src"] = SRC
            ok += 1
            print("✔ p%-2d [%s] #%s %-22s top10=%d alloc保留=%d" %
                  (pi + 1, plan, fid, (x.get("fundBase") or "")[:22], len(top10),
                   len(rec.get("alloc") or [])), flush=True)
    pdf.close()
    miss = TARGETS - set(seen)
    print("匹配 %d / 15；未匹配: %s" % (ok, ",".join(sorted(miss)) if miss else "無"))
    if WRITE:
        hld["updatedAt"] = int(time.time() * 1000)
        srcs = set()
        for v in hld["funds"].values():
            if v.get("src"):
                srcs.add(v["src"].split("（")[0])
        hld["source"] = " + ".join(sorted(srcs))
        json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
        print("已寫回 holdings.json")


if __name__ == "__main__":
    main()
