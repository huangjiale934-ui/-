# -*- coding: utf-8 -*-
"""BCT 15 只 mpf.hk 轉載換源（tools/replace-mpfhk-bct.py）
====================================================================
兩類：
  A) 800 系列 I 類 9 只（427/429/431/433/435/441/447/451/620）：
     S800_FFS_2026Q2.pdf 只載 A 類頁；I 類與 A 類**同一基金同名投資組合**，
     從剛刷新的 A 類記錄複製（官方口徑，與 run_file 的「同組合複製」一致）。
  B) 明智/易富「動力系」6 只（147/838/839/160/161/162）：
     便覽 Top 10 版式為「名稱+數值同行、名稱可跨行、首行帶頁邊腳注」，
     top10_columns 漏 2 條（n=8/9 < 10 不覆蓋）→ 專用行式解析，逐條對數。需 --write 才寫庫。

用法：python tools/replace-mpfhk-bct.py --write
"""
import json
import os
import re
import sys
import time

import pdfplumber

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, "data", "holdings.json")
ASOF = "2026-06-30"

I_COPY = {  # I 類 ← A 類
    "427": "426", "429": "428", "431": "430", "433": "432", "435": "434",
    "441": "440", "447": "446", "451": "450", "620": "619",
}
DYN = {"147": ("Smart_FFS_2026Q2.pdf", 4), "838": ("Smart_FFS_2026Q2.pdf", 5),
       "839": ("Smart_FFS_2026Q2.pdf", 7), "161": ("Simple_FFS_2026Q2.pdf", 4),
       "160": ("Simple_FFS_2026Q2.pdf", 5), "162": ("Simple_FFS_2026Q2.pdf", 6)}

ROW = re.compile(r"^(.*?)\s+(\d{1,2}\.\d{2})\b")
VAL = re.compile(r"^\d{1,2}\.\d{2}$")


def parse_dyn(pg):
    """動力系 Top 10（座標版）：區塊在頁面底部單欄，數值列 x 聚類定位；
    名稱可跨行（上一行無數值則併入），頁邊腳注（x 遠大於數值列）自然排除。"""
    ws = pg.extract_words(x_tolerance=2)
    anchor = next((w for w in ws if "十大主要投資項目" in w["text"]
                   or w["text"] == "十大主要投資項目"), None)
    if anchor is None:
        tw = [w for w in ws if w["text"] == "Holdings"]
        anchor = tw[-1] if tw else None
    if anchor is None:
        return []
    y0 = anchor["top"]
    seg = [w for w in ws if y0 + 1 < w["top"] < min(y0 + 200, pg.height - 8)]
    # 數值列：NN.NN 詞的 x 眾數聚類（±18）
    num_ws = [w for w in seg if VAL.match(w["text"])]
    if not num_ws:
        return []
    from collections import Counter
    xc = Counter(round(w["x0"] / 18) for w in num_ws)
    col, cnt = xc.most_common(1)[0]
    if cnt < 5:
        return []
    lo, hi = col * 18 - 18, col * 18 + 18
    vals = sorted([w for w in num_ws if lo <= w["x0"] <= hi], key=lambda w: w["top"])
    # 有數值的行集合（供跨行判斷）
    val_tops = {round(v["top"]) for v in vals}
    out = []
    for v in vals:
        nm = [w for w in seg if abs(w["top"] - v["top"]) <= 3.5
              and w["x1"] <= v["x0"] + 2 and w["x0"] > 15 and not VAL.match(w["text"])]
        name = " ".join(w["text"] for w in sorted(nm, key=lambda z: z["x0"]))
        # 跨行：上一行（4~12pt 上方）無數值 → 其左欄文字併入名稱前部
        if len(name) < 26:
            up = [w for w in seg if 3 < v["top"] - w["top"] <= 12.5
                  and w["x1"] <= v["x0"] + 2 and w["x0"] > 15
                  and not VAL.match(w["text"])
                  and round(w["top"]) not in val_tops
                  and not any(abs(w["top"] - t) <= 3.5 for t in val_tops)]
            if up:
                pre = " ".join(w["text"] for w in sorted(up, key=lambda z: z["x0"]))
                name = (pre + " " + name).strip()
        if not name:
            continue
        out.append({"name": re.sub(r"\s+", " ", name)[:80], "weight": float(v["text"])})
    return out


def main():
    write = "--write" in sys.argv
    hld = json.load(open(HOLD, encoding="utf-8"))
    n = 0

    # A) I 類複製
    for iid, aid in I_COPY.items():
        a = hld["funds"].get(aid) or {}
        if not a.get("top10"):
            print("✘ #%s 缺 A 類 #%s 數據" % (iid, aid))
            continue
        rec = hld["funds"].setdefault(iid, {})
        rec["asOf"] = a.get("asOf") or ASOF
        rec["top10"] = json.loads(json.dumps(a["top10"]))
        rec["alloc"] = json.loads(json.dumps(a.get("alloc") or []))
        rec["allocSum"] = a.get("allocSum")
        rec["allocIncomplete"] = a.get("allocIncomplete")
        rec["src"] = "BCT 官方基金便覽 PDF（S800_FFS_2026Q2.pdf）（I 類單位共用同一投資組合）"
        n += 1
        print("✔ I複製 #%s ← #%s top10=%d" % (iid, aid, len(rec["top10"])), flush=True)

    # B) 動力系解析
    pdfs = {}
    for fid, (fn, pi) in DYN.items():
        if fn not in pdfs:
            pdfs[fn] = pdfplumber.open(os.path.join(BASE, "tmp", "bct_auto", fn))
        pg = pdfs[fn].pages[pi]
        top = parse_dyn(pg)
        print(("%s #%s p%d 解析 n=%d" % (fn, fid, pi + 1, len(top)),
               [("%s %.2f" % (x["name"][:30], x["weight"])) for x in top[:3]]) if top else "✘")
        if len(top) != 10:
            print("  ✘ #%s top10=%d ≠10，跳過（寧缺勿錯）" % (fid, len(top)))
            continue
        rec = hld["funds"].setdefault(fid, {})
        rec["asOf"] = ASOF
        rec["top10"] = top
        rec["src"] = "BCT 官方基金便覽 PDF（%s）" % fn
        n += 1
    for p in pdfs.values():
        p.close()

    print("共 %d 條" % n)
    if write:
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
