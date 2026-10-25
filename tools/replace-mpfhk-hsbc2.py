# -*- coding: utf-8 -*-
"""滙豐/恒生智選計劃 換源 v2（tools/replace-mpfhk-hsbc2.py）
====================================================================
用戶指正（2026-10-24）：官方便覽就是 https://www.hsbc.com.hk/content/dam/hsbc/hk/docs/mpf/invrptce1.pdf
（MD5 與 ffs.pdf 完全一致，同一份文件 2026Q2，截至 30/06/2026）。
**每頁上下兩只基金**（頁首標題只標上半），全冊 20 頁 = 28 個基金區塊 > 計劃 20 只（部分頁重複展示）。

區塊 ↔ 基金的歸屬用**單位價格精確匹配**：每區塊「單位價格 Unit price」為 2026-06-30 淨值（4 位小數），
與 data/hist/<id>.json 在 2026-06-30 的淨值精確相等（已驗證 324=45.2066 ✓；匯豐 HB 與恒生 HS
同基金價格在 4 位小數上可區分，故兩份 PDF 分別只與各自計劃的 hist 匹配）。

解析：每區塊『投資組合內十大資產 Top 10 portfolio holdings (%)』下方，
名稱列 x≈205-370（中文名行+英文名行），數值列 x≈374；右欄評論 x≥396 排除。

用法：python tools/replace-mpfhk-hsbc2.py --write
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
VAL = re.compile(r"^\d{1,2}(?:\.\d+)?$")
PRICE = re.compile(r"HK\$\s*([\d]+\.\d{4})")
CJK = re.compile(r"[\u4e00-\u9fff]")
LATIN = re.compile(r"^[A-Za-z&\-']+$")


def _join_name(words):
    """同行名稱拼接：中文字詞直連；含數字的詞保留（債券利率/到期日是同名債券的
    唯一區分，如 '4.25% 31/01/2030'）；拉丁碎片（純字母 ≤3 字符）丟棄；完整英文詞保留。
    應對小字號 PDF 的字符碎裂（'中 國 建 設 銀 行'、'C h in a'）。"""
    parts, buf = [], ""
    for w in words:
        t = w["text"]
        if CJK.search(t):
            if buf and CJK.search(buf[-1]) and CJK.match(t[0]):
                buf += t
            else:
                if buf:
                    parts.append(buf)
                buf = t
        elif re.search(r"\d", t) or (len(t) >= 4 and re.match(r"^[A-Za-z&\-'/]+$", t)) \
                or (t.isupper() and 2 <= len(t) <= 4 and re.match(r"^[A-Z/&\-']+$", t)):
            if buf:
                parts.append(buf)
                buf = ""
            parts.append(t)
        # 小寫/混合大小寫的 1-3 字符碎片 → 丟棄
    if buf:
        parts.append(buf)
    return " ".join(p.strip() for p in parts if p.strip())

TARGETS = {"317", "320", "325", "326", "803", "302", "305", "307", "311", "807"}
JOBS = [
    ("tmp/hsbc_invrptce1.pdf", "滙豐強積金智選計劃基金概覽 PDF（FFS 2026Q2，invrptce1）", "HB"),
    # 恒生版若與匯豐同冊則跳過（下面 main 會偵測 hase PDF 是否存在）
    ("tmp/hase_invrptce1.pdf", "恒生強積金智選計劃基金概覽 PDF（FFS 2026Q2，invrptce1）", "HS"),
]


def load_hist_nav(fid, date):
    p = os.path.join(BASE, "data", "hist", "%s.json" % fid)
    if not os.path.exists(p):
        return None
    h = json.load(open(p, encoding="utf-8"))
    arr = h.get("series") if isinstance(h, dict) else h
    if arr is None and isinstance(h, dict):
        arr = h.get("points") or []
    for pt in arr:
        if pt[0] == date:
            return float(pt[1])
    return None


def parse_block(ws, y0, y1):
    """一個基金區塊：返回 (price, top10)"""
    seg = [w for w in ws if y0 <= w["top"] < y1]
    # 單位價格：HK$XX.XXXX（區塊上半部的基金資料列）
    price = None
    for w in seg:
        m = PRICE.search(w["text"])
        if m:
            price = float(m.group(1))
            break
    # 十大區
    anc = next((w for w in seg if "投資組合內十大資產" in w["text"]), None)
    if not anc:
        return price, []
    a_y = anc["top"]
    ten = [w for w in seg if a_y + 2 < w["top"] < a_y + 175 and w["x0"] < 392]
    # 數值列：x∈[360,390] 的詞按行聚類（±2.6）→ 同行拼接（'5' '.' '1' → '5.1'）
    raw_vals = [w for w in ten if 360 <= w["x0"] <= 390]
    rows = {}
    for w in raw_vals:
        key = next((k for k in rows if abs(k - w["top"]) <= 2.6), None)
        rows.setdefault(key if key is not None else w["top"], []).append(w)
    vals = []
    for y in sorted(rows):
        ws_row = sorted(rows[y], key=lambda z: z["x0"])
        # 排除混入數值列的純字母詞（如 'Co'@360）
        numtxt = "".join(w["text"] for w in ws_row
                         if not re.match(r"^[A-Za-z]+$", w["text"])).replace(" ", "")
        m = re.match(r"^(\d{1,2}(?:\.\d+)?)$", numtxt)
        if m:
            vals.append({"top": y, "x0": 374, "weight": float(m.group(1))})
    vals = [v for v in vals if v["top"] > a_y + 18]
    if len(vals) < 8:
        return price, []
    val_tops = {round(v["top"]) for v in vals}
    out = []
    for v in vals:
        nm = [w for w in ten if abs(w["top"] - v["top"]) <= 2.6
              and 205 <= w["x0"] and w["x1"] <= 372 and not VAL.match(w["text"])
              and w["text"] not in ("Securities", "證券", "持有量", "(%)")]
        zh_up = [w for w in ten
                 if 2.5 < v["top"] - w["top"] <= 8.5 and 205 <= w["x0"] and w["x1"] <= 340
                 and CJK.search(w["text"])
                 and not any(abs(w["top"] - t) <= 2.6 for t in val_tops)]
        name = _join_name(sorted(nm, key=lambda z: z["x0"]))
        if zh_up:
            pre = _join_name(sorted(zh_up, key=lambda z: z["x0"]))
            if pre and pre not in name:
                name = (pre + " " + name).strip()
        if name:
            out.append({"name": name[:80], "weight": v["weight"]})
    # 去重
    seen, dedup = set(), []
    for x in out:
        if x["name"] not in seen:
            seen.add(x["name"])
            dedup.append(x)
    return price, dedup[:10]


def main():
    write = "--write" in sys.argv
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(BASE, "data", "funds.json"), encoding="utf-8"))["funds"]
    # 計劃 → 基金池（trustee 區分匯豐/恒生智選）
    n_total = 0
    for path, src, plan_code in JOBS:
        ap = path if os.path.isabs(path) else os.path.join(BASE, path)
        if not os.path.exists(ap):
            print("· 跳過（無 PDF）:", ap)
            continue
        pool = {}
        for x in FN:
            if str(x["id"]) in TARGETS and x.get("navSource", "").startswith(
                    "滙豐" if plan_code == "HB" else "恒生"):
                pool[str(x["id"])] = x
        if not pool:
            # navSource 前綴不合則用 scheme
            for x in FN:
                if str(x["id"]) in TARGETS and (
                        "滙豐" if plan_code == "HB" else "恒生") in (x.get("scheme") or ""):
                    pool[str(x["id"])] = x
        # hist 06-30 價格表
        nav_by_price = {}
        for fid in pool:
            nv = load_hist_nav(fid, ASOF)
            if nv is not None:
                nav_by_price[round(nv, 4)] = fid
        print("== %s（%s）：%d 只目標，hist 價格 %d 個" % (
            os.path.basename(ap), plan_code, len(pool), len(nav_by_price)))
        pdf = pdfplumber.open(ap)
        matched = {}
        for pi, pg in enumerate(pdf.pages):
            ws = pg.extract_words(x_tolerance=2)
            anchors = sorted([w for w in ws if "投資組合內十大資產" in w["text"]],
                             key=lambda w: w["top"])
            if not anchors:
                continue
            page_h = pg.height
            for ai, anc in enumerate(anchors):
                y0 = max(0, anc["top"] - 120)  # 區塊頂（含基金資料列的單位價格）
                y1 = min(page_h, anchors[ai + 1]["top"] - 2) if ai + 1 < len(anchors) else page_h
                price, top = parse_block(ws, y0, y1)
                if price is None or len(top) < 8:
                    continue
                fid = nav_by_price.get(round(price, 4))
                if not fid:
                    continue
                if fid in matched:
                    continue
                matched[fid] = (pi + 1, price, top)
        pdf.close()
        print("  價格匹配到 %d 個區塊："%len(matched),
              ",".join(sorted(matched)) or "無")
        for fid, (pgno, price, top) in sorted(matched.items()):
            s = round(sum(x["weight"] for x in top), 2)
            ok = len(top) == 10
            print("  #%s p%d HK$%.4f top=%d 合計=%.2f %s" % (
                fid, pgno, price, len(top), s, "✓" if ok else "✗"))
            if not write or not ok:
                continue
            rec = hld["funds"].setdefault(fid, {})
            rec["asOf"] = ASOF
            rec["top10"] = top
            rec["src"] = src
            n_total += 1
    print("共 %d 條" % n_total)
    if write and n_total:
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
