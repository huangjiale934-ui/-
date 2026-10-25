# -*- coding: utf-8 -*-
"""東亞持仓解析 v2（bea_holdings.py）—— 每页两只基金（两个 Top 区块）
====================================================================
用户指正（2026-10-19）：東亞基金概覽 PDF（28 页）**每页含两个「Top 10 Portfolio Holdings」区块**
（上半 y≈226 / 下半 y≈619），旧版只取第一个 → 17 只只覆盖 5 只。
布局：名称（英文+中文）x 360-530、百分比固定 x≈542；基金名 = 页首 / 中部的「BEA (MPF) XX Fund」。
三计划：Master Trust（p2-13 上半）、Value Scheme 享惠（p14-19）、Industry 行業（p21-27）。
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
PDF = sys.argv[1] if len(sys.argv) > 1 else os.path.join(BASE, "tmp", "bea_ffs.pdf")

KWS = [('European Equity', '歐洲股票'), ('Global Equity', '環球股票'), ('Hong Kong Equity', '香港股票'),
       ('Greater China', '大中華'), ('China Equity', '中國股票'), ('Asian Equity', '亞洲股票'),
       ('Korean Equity', '韓國股票'), ('US Equity', '美國股票'), ('North American Equity', '北美'), ('Japan Equity', '日本股票'),
       ('Japanese Equity', '日本股票'), ('Conservative', '保守'), ('Core Accumulation', '核心累積'),
       ('Age 65 Plus', '65歲後'), ('Guaranteed', '保證'), ('Hang Seng Index', '恒生指數'),
       ('Hong Kong Tracker', '香港追蹤'), ('China Tracker', '中國追蹤'), ('Global Bond', '環球債券'),
       ('Hong Kong Bond', '香港債券'), ('Asian Bond', '亞洲債券'), ('China Bond', '中國債券'),
       ('Money Market', '貨幣'), ('Capital Stable', '資本穩定'), ('Balanced', '均衡'),
       ('Growth', '增長'), ('Stable', '平穩')]


def parse_block(words, ty, y_end):
    rows = {}
    for w in words:
        if ty - 2 <= w["top"] <= y_end:
            rows.setdefault(round(w["top"]), []).append(w)
    top10 = []
    for k in sorted(rows):
        ws = sorted(rows[k], key=lambda w: w["x0"])
        pcts = [w for w in ws if 528 <= w["x0"] <= 556 and re.match(r"^\d+\.\d+%$", w["text"])]
        if not pcts:
            continue
        nm = " ".join(w["text"] for w in ws if 355 <= w["x0"] < 528).strip()
        if nm:
            top10.append({"name": nm[:60], "weight": float(pcts[0]["text"].rstrip("%"))})
        if len(top10) >= 10:
            break
    return top10


def main():
    force = "--force" in sys.argv
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ea = [x for x in FN if "東亞" in (x.get("trustee") or "")]
    pdf = pdfplumber.open(PDF)
    ok = 0
    plan = "集成信託"
    # 2026-10-24：asOf 改为从 PDF 提取（原硬编码 2026-06-30，换季会写错期数）
    asof = None
    for _pg0 in pdf.pages[:2]:
        _t = _pg0.extract_text() or ""
        _m = re.search(r"As of\s*(\d{1,2}/\d{1,2}/\d{4})\s*截至", _t)
        if _m:
            d, mth, y = _m.group(1).split("/")
            asof = "%s-%02d-%02d" % (y, int(mth), int(d))
            break
    if not asof:
        print("✘ 未能从 PDF 提取 asOf，退出（不写库）")
        pdf.close()
        return
    src = "東亞銀行基金概覽 PDF（FFS，%s）" % asof
    print("asOf=%s src=%s%s" % (asof, src, " [force]" if force else ""))
    for pi, pg in enumerate(pdf.pages):
        t = pg.extract_text() or ""
        if "Value Scheme" in t:
            plan = "享惠"
        if "Industry Scheme" in t and "Remarks" not in t:
            plan = "行業"
        words = pg.extract_words(x_tolerance=3)
        # 所有 Top 区块 y（升序）
        tys = sorted(set(round(w["top"]) for w in words if w["text"] == "Top"))
        if not tys:
            continue
        # 页内基金名：从整页文本行按出现顺序提取（名称可能跨多词/多行）
        names = []
        for l in t.split("\n"):
            m = re.search(r"BEA (?:\(MPF\) )?\(?([A-Za-z0-9 &\-()]+?)\)? Fund", l)
            if m:
                nm = m.group(1).strip()
                if not names or names[-1][1] != nm:
                    names.append((len(names), nm))
        page_h = max(w["top"] for w in words) if words else 800
        for bi, ty in enumerate(tys):
            y_end = (tys[bi + 1] - 4) if bi + 1 < len(tys) else min(ty + 130, page_h)
            y_end = min(y_end, ty + 130)
            # 名称：区块上方最近（或页内顺序第 bi 个）
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
                print("✘ p%d 无关键词: %s" % (pi + 1, en))
                continue
            cand = [x for x in ea if plan in (x.get("scheme") or "")] or ea
            x = None
            for v in cand:
                if kw in (v.get("fundBase") or ""):
                    x = v
                    break
            if not x:
                print("✘ p%d 未匹配: %s → %s" % (pi + 1, en, kw))
                continue
            old = hld["funds"].get(str(x["id"]))
            # 2026-10-24：--force 时按 asOf 判断（旧记录期数早于本次才覆盖）；
            # 非 force 保持原「补缺不覆盖」。alloc 永远保留旧值（分布为读图数据）。
            if old and (old.get("asOf") or "") >= asof and not force:
                continue
            if force and old and (old.get("asOf") or "") >= asof:
                continue
            hld["funds"][str(x["id"])] = {
                "asOf": asof,
                "src": src,
                "top10": top10,
                "alloc": (old or {}).get("alloc", []),
                "allocLabel": None,
            }
            ok += 1
            print("✔ p%d [%s] #%s %s top10=%d" % (pi + 1, plan, x["id"], (x.get("fundBase") or "")[:18], len(top10)), flush=True)
    pdf.close()
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
