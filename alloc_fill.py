# -*- coding: utf-8 -*-
"""投资组合分布补齐（alloc_fill.py）
按来源分别解析，只补 alloc 为空的基金（不覆盖已有）。
已实现：
  · BCT 信安系（800/明智/易富）—— 右栏「投資分布 Asset Allocation Breakdown」按列取
  · 東亞（BEA）—— 「Portfolio Allocation 投資組合分布」字母键 A:/B:/C: 行，按标题分区
  · 海通 —— 「ASSET ALLOCATION 資產分佈」柱状图标签（y 分带法）
用法：python alloc_fill.py [--dry]
"""
import glob
import json
import os
import re
import sys
import time

import pdfplumber

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
ARCH = os.path.join(os.path.dirname(BASE), "mpf-app-tmp-archive", "2026-10-19")

CJK = re.compile(r"[\u4e00-\u9fff]")


def norm(s):
    s = (s or "").replace("（", "(").replace("）", ")").replace("\u3000", "").replace(" ", "")
    return s


def pick_label(txt):
    """从「English 中文 3」这类片段里取中文标签，去掉尾注数字"""
    runs = re.findall(r"[\u4e00-\u9fff][\u4e00-\u9fff/及、()A-Za-z ]*", txt)
    if not runs:
        return ""
    lbl = max(runs, key=len).strip()
    lbl = re.sub(r"\s*\d+$", "", lbl).strip()
    return lbl


def clean_label(lbl):
    """去掉括號補充說明與尾註星號：現金及短期投資(例如:票據及存款)→現金及短期投資"""
    if not lbl:
        return ""
    lbl = re.split(r"[（(]", lbl)[0]
    return lbl.strip().rstrip("*").strip()


def label_of(txt):
    """標籤詞取中文名。
    先剝說明性括號（例如…/e.g.…）；整體以中文開頭則整取（保留語義括號：
    亞太（港元除外）不能被截成「港元除外」——pick_label 取最長中文段會恰好吃掉括號裡
    更長的那段）；否則退回 pick_label。尾註星號/數字一併清掉。"""
    if not txt:
        return ""
    m = re.search(r"[（(]\s*(例如|eg\.?|e\.g\.?|i\.e\.?|such\s+as|including)", txt, re.I)
    if m:
        txt = txt[:m.start()]
    txt = txt.strip()
    if CJK.match(txt):
        lbl = re.sub(r"[（(]\s*\d+\s*[)）]$", "", txt)   # 債券(1) → 債券
        lbl = re.sub(r"\s*\d+$", "", lbl).strip()         # 港元現金及其他3 → 港元現金及其他
        return lbl.rstrip("*").strip()
    return pick_label(txt)


def pair_below(nums, lbls, tol):
    """BCT 系便覽排版：中文標籤與數值同一行、或在數值行下方若干 pt。
    按數值閱讀順序（top, x0）各配一個「垂直距離最近且未用過」的標籤——
    不管制「用過」會讓相鄰兩項重複配到同一個標籤（如 50.02/49.98 都配到「債券」）。"""
    ns = sorted(nums, key=lambda z: (round(z["top"], 1), z["x0"]))
    ls = sorted(lbls, key=lambda z: (round(z["top"], 1), z["x0"]))
    used = [False] * len(ls)
    pairs = []
    for n in ns:
        best, bi = None, -1
        for i, l in enumerate(ls):
            if used[i]:
                continue
            d = l["top"] - n["top"]
            if abs(d) > tol:
                continue
            key = (abs(d), 0 if d >= 0 else 1, i)
            if best is None or key < best:
                best, bi = key, i
        if bi >= 0:
            used[bi] = True
            pairs.append((n, ls[bi]))
    return pairs


# ---------------- 信安（BCT 800/明智/易富）：右栏按列 ----------------
def alloc_xinan(pg):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if "投資分布" in w["text"]]
    if not hd:
        return []
    y0 = hd[0]["top"]
    # 2026-10-19：塊尾截斷在下一個「分布」欄位（亞洲債券基金頁下方緊跟行業分布，
    # 舊版 y0+260 視窗把兩塊數值都抓了，合計 199.9）
    stops = [w["top"] for w in ws
             if ("分布" in w["text"] or "分佈" in w["text"]) and w["top"] > y0 + 2]
    yend = min(stops) if stops else y0 + 260
    # 2026-10-19：中文标签在数值行下方 2.6–6.2pt；数值放宽到 \d{1,3}\.\d{1,2}
    # （明智/易富頁出現 49.98、-1.14 等两位小數）
    nums = [w for w in ws if y0 < w["top"] < yend and w["x0"] >= 545
            and re.match(r"^\d{1,3}\.\d{1,2}$", w["text"])]
    lbls = [t for t in ws if y0 < t["top"] < yend and 398 <= t["x0"] < 545
            and CJK.search(t["text"])]
    out = []
    for n, l in pair_below(nums, lbls, 8):
        lbl = label_of(l["text"])
        if lbl and 0 < float(n["text"]) <= 100:
            out.append({"label": lbl, "weight": float(n["text"])})
    return out


# ---------------- 交通銀行（BCOM）：右栏「資產分佈」柱狀圖標簽版式 ----------------
# 2026-10-19：每格 = 中文標簽 →（+6pt）英文（可能兩行）→ 百分比，值與中文標簽 x 重疊。
# Top-10 持倉從 x≈415 起（編號 1.-10. 在 x≈360-386、持倉名 x≈391、權重 x≈530），
# 故資產分佈帶取 x0∈[250,400)；帶内只有分佈格，不會混入持倉。
BOCOM_XB_LO, BOCOM_XB_HI = 250.0, 400.0
BOCOM_VAL = re.compile(r"^-?\d{1,3}\.\d%$")


def alloc_bocom(pg):
    """返回 [{'title': 基金名, 'items': [...]}, ...]（每頁 1-2 個分佈區）"""
    ws = pg.extract_words(x_tolerance=1.5, y_tolerance=1.5)
    anchors = sorted([w["top"] for w in ws if "資產分佈" in w["text"]])
    if not anchors:
        return []
    # 基金名：10pt 大字、含「基金」（英文名行是 Fund 不含「基金」；計劃抬頭 12pt）
    big = {}
    for c in pg.chars:
        if 9.5 <= c.get("size", 0) <= 10.5:
            big.setdefault(round(c["top"], 0), []).append(c)
    titles = []
    for y in sorted(big):
        s = "".join(ch["text"] for ch in sorted(big[y], key=lambda z: z["x0"])).strip()
        if s and "基金" in s:
            titles.append((y, s))
    out = []
    for i, y0 in enumerate(anchors):
        yend = anchors[i + 1] if i + 1 < len(anchors) else pg.height
        # 標題：本錨點上方、上一個錨點之下的最近一行
        prev = max([x for x in anchors if x < y0], default=0)
        tc = [t for t in titles if prev < t[0] < y0]
        title = tc[-1][1] if tc else ""
        band = lambda w: BOCOM_XB_LO <= w["x0"] < BOCOM_XB_HI
        vals = [w for w in ws if y0 + 2 < w["top"] < yend and band(w)
                and BOCOM_VAL.match(w["text"])]
        lbls = [w for w in ws if y0 + 2 < w["top"] < yend and band(w)
                and CJK.search(w["text"]) and not BOCOM_VAL.match(w["text"])
                and len(w["text"]) <= 12
                and "資料來源" not in w["text"]
                and not w["text"].startswith(("*", "#", "(", "（", "▲", "^"))]
        # 貪心配對：每個值配一個「上方 30pt 內、x 重疊、未用過」的最近中文標簽
        used = [False] * len(lbls)
        items = []
        for v in sorted(vals, key=lambda z: (round(z["top"], 1), z["x0"])):
            best, bi = None, -1
            for j, l in enumerate(lbls):
                if used[j] or l["top"] >= v["top"] or v["top"] - l["top"] > 30:
                    continue
                if not (l["x0"] - 8 <= v["x0"] and v["x1"] <= l["x1"] + 8):
                    continue
                key = (abs(v["top"] - l["top"]), abs(v["x0"] - l["x0"]))
                if best is None or key < best:
                    best, bi = key, j
            if bi >= 0:
                used[bi] = True
                lbl = label_of(lbls[bi]["text"])
                if lbl and -100 < float(v["text"][:-1]) <= 100:
                    items.append({"label": lbl, "weight": float(v["text"][:-1])})
        out.append({"title": title, "items": items})
    return out


# ---------------- 通用坐標解析（東亞 / 中國人壽 等「標簽+百分比同帶」版式） ----------------
# 2026-10-19：東亞便覽的圖表把中文標簽畫成逐字旋轉文本（extract_text 會交錯），
# 但 extract_words 的坐標可靠：數值行與中文標簽行相差 3–10pt、x 順序即閱讀順序。
# 策略：按 top 分組數值行 → 每行配標簽（±lw）→ 取「合計最接近 100」的行（強判別信號）。
GEN_ANCHORS = ("投資組合分佈", "投資組合分布", "資產分佈", "資產配置")
GEN_VAL = re.compile(r"^\d{1,3}\.\d{1,2}%$")
GEN_SKIP = ("最近期", "基金開支比率", "曆年", "資料來源", "本基金", "參考投資組合",
            "1年", "3年", "5年", "10年", "自成立起", "年初至今", "年", "回報", "比率", "分佈")
GEN_DROP = ("不適用", "N/A", "指數", "參考")


def _split_pct(ws):
    """把「股票22.1%」「Securities80.52%」拆成標簽詞 + 數值詞"""
    out = []
    for w in ws:
        # 數值與 % 之間可能有空格（「11.4 %」）——先規範化
        m0 = re.match(r"^(\d{1,3}\.\d{1,2})\s+%$", w["text"])
        if m0:
            w = dict(w); w["text"] = m0.group(1) + "%"
        m = re.match(r"^(.*?)(\d{1,3}\.\d{1,2}%)$", w["text"])
        if m and m.group(1):
            cut = w["x0"] + (w["x1"] - w["x0"]) * 0.55
            out.append({"text": m.group(1), "top": w["top"], "x0": w["x0"], "x1": cut})
            out.append({"text": m.group(2), "top": w["top"], "x0": cut, "x1": w["x1"]})
        else:
            out.append(w)
    # 數值與 % 分成兩個詞（「11.4」「%」）→ 合併
    merged, skip = [], set()
    for i, w in enumerate(out):
        if i in skip:
            continue
        if re.match(r"^\d{1,3}\.\d{1,2}$", w["text"]):
            done = False
            for j in range(i + 1, min(i + 3, len(out))):
                nxt = out[j]
                if j in skip:
                    continue
                if nxt["text"] == "%" and abs(nxt["top"] - w["top"]) <= 1.5 and 0 <= nxt["x0"] - w["x1"] <= 4:
                    merged.append({"text": w["text"] + "%", "top": w["top"], "x0": w["x0"], "x1": nxt["x1"]})
                    skip.add(j)
                    done = True
                    break
            if not done:
                merged.append(w)
            continue
        merged.append(w)
    return merged


def _merge_cjk(words):
    """同一行、x 相鄰的中文碎詞合併（「存」「款」→「存款」）"""
    words = sorted(words, key=lambda z: (round(z["top"], 0), z["x0"]))
    out = []
    for w in words:
        if out and abs(out[-1]["top"] - w["top"]) <= 1.2 and 0 <= w["x0"] - out[-1]["x1"] <= 6:
            out[-1]["text"] += w["text"]
            out[-1]["x1"] = w["x1"]
        else:
            out.append({"text": w["text"], "top": w["top"], "x0": w["x0"], "x1": w["x1"]})
    return out


def alloc_generic(pg, lw=6.5):
    ws = _split_pct(pg.extract_words(x_tolerance=2, y_tolerance=2))
    anchors = sorted([w["top"] for w in ws if any(a in w["text"] for a in GEN_ANCHORS)])
    if not anchors:
        return []
    y0 = anchors[0]
    vals = [w for w in ws if y0 + 3 < w["top"] < y0 + 60 and GEN_VAL.match(w["text"])]
    if not vals:
        return []
    best = None
    for t in sorted({round(v["top"], 0) for v in vals}):
        cand = [v for v in vals if abs(v["top"] - t) <= 2.5]
        ls = [w for w in ws if abs(w["top"] - t) <= lw and CJK.search(w["text"])
              and not GEN_VAL.match(w["text"])
              and not any(s in w["text"] for s in GEN_SKIP)
              and not re.match(r"^[\d.%]+$", w["text"]) and len(w["text"]) <= 24]
        ls = [l for l in _merge_cjk(ls) if l["text"].strip() not in GEN_DROP]
        if not ls:
            continue
        cand.sort(key=lambda z: z["x0"])
        ls.sort(key=lambda z: z["x0"])
        if len(ls) == len(cand):
            pairs = list(zip(cand, ls))
        else:
            used = [False] * len(ls)
            pairs = []
            for v in cand:
                bi, bd = -1, None
                for i, l in enumerate(ls):
                    if used[i]:
                        continue
                    d = abs((l["x0"] + l["x1"]) / 2 - (v["x0"] + v["x1"]) / 2)
                    if bd is None or d < bd:
                        bd, bi = d, i
                if bi >= 0 and bd <= 55:
                    used[bi] = True
                    pairs.append((v, ls[bi]))
        if not pairs:
            continue
        tot = sum(float(v["text"][:-1]) for v, _ in pairs)
        if 70 <= tot <= 106:
            score = (abs(tot - 100), t)
            if best is None or score < best[0]:
                best = (score, pairs)
    if not best:
        return []
    out = []
    for v, l in best[1]:
        lbl = label_of(l["text"])
        if lbl and 0 < float(v["text"][:-1]) <= 100:
            out.append({"label": lbl, "weight": float(v["text"][:-1])})
    return out


# ---------------- 中銀保誠：餅圖引線標簽（中文→英文→數值，三行一格） ----------------
def alloc_bocpt(pg, xmin=280.0, h=230.0):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if "資產分佈" in w["text"] or "資產配置" in w["text"]]
    if not hd:
        return []
    y0 = hd[0]["top"]
    seg = [w for w in ws if y0 - 2 < w["top"] < y0 + h and w["x0"] > xmin]
    vals = [w for w in seg if GEN_VAL.match(w["text"])]
    lbls = [w for w in seg if CJK.search(w["text"]) and not GEN_VAL.match(w["text"])
            and not any(s in w["text"] for s in GEN_SKIP)
            and not re.match(r"^[\d.%]+$", w["text"])
            and w["text"].strip() not in GEN_DROP and len(w["text"]) <= 12]
    used = [False] * len(lbls)
    out = []
    for v in sorted(vals, key=lambda z: z["top"]):
        best, bi = None, -1
        for i, l in enumerate(lbls):
            if used[i] or l["top"] >= v["top"] or v["top"] - l["top"] > 26:
                continue
            if not (l["x0"] - 12 <= v["x0"] and v["x1"] <= l["x1"] + 12):
                continue
            key = (v["top"] - l["top"], abs((l["x0"] + l["x1"]) / 2 - (v["x0"] + v["x1"]) / 2))
            if best is None or key < best:
                best, bi = key, i
        if bi >= 0:
            used[bi] = True
            lbl = label_of(lbls[bi]["text"])
            if lbl and 0 < float(v["text"][:-1]) <= 100:
                out.append({"label": lbl, "weight": float(v["text"][:-1])})
    return out


def _lcs_len(a, b):
    """最長公共子串長度（用於便覽字體缺字時的模糊標題匹配）"""
    best = 0
    for i in range(len(a)):
        for j in range(i + 1, len(a) + 1):
            if a[i:j] in b:
                best = max(best, j - i)
    return best


# ---------------- 東亞：字母键 + 标题分区 ----------------
def alloc_letters_page(pg, schemes):
    """返回 {fund_id: alloc}"""
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hdrs = sorted([w["top"] for w in ws if "投資組合分布" in w["text"] or "Portfolio Allocation" in w["text"]])
    if not hdrs:
        return {}
    # 每页的基金标题（以「基金」结尾、字号较大）
    chars = pg.chars
    big = {}
    for c in chars:
        if c.get("size", 0) >= 9.5:
            big.setdefault(round(c["top"], 0), []).append(c)
    titles = []
    for y in sorted(big):
        s = "".join(ch["text"] for ch in sorted(big[y], key=lambda z: z["x0"]))
        if "基金" in s and len(s) < 40:
            titles.append((y, s.strip()))
    res = {}
    for i, yh in enumerate(hdrs):
        yend = hdrs[i + 1] - 3 if i + 1 < len(hdrs) else min(yh + 260, pg.height)
        # 标题：该 alloc 区块上方最近的标题
        above = [t for t in titles if t[0] < yh + 6]
        if not above:
            continue
        title = above[-1][1]
        items = []
        for w in ws:
            if not (yh - 2 < w["top"] < yend):
                continue
            m = re.match(r"^([A-Z]):(.+)$", w["text"])
            if m:
                items.append([w["top"], m.group(2), None])
                continue
            if re.match(r"^\d+\.\d%$", w["text"]):
                items.append([w["top"], None, float(w["text"][:-1])])
        # 合并同一行的键名与数值
        merged, pend = [], None
        for y, body, pct in sorted(items):
            if body is not None:
                pend = body
            elif pct is not None and pend is not None:
                lbl = pick_label(pend)
                if lbl:
                    merged.append({"label": lbl, "weight": pct})
                pend = None
        if len(merged) >= 3:
            res[title] = merged
    return res


# ---------------- 海通：柱状图标签，取「同列最近的标签」 ----------------
def alloc_haitong(pg):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if w["text"] == "ASSET" and w["top"] < pg.height * 0.4]
    if not hd:
        return []
    y0 = hd[0]["top"]
    pcts = [w for w in ws if y0 < w["top"] < y0 + 160 and w["x0"] > 285
            and re.match(r"^\d{1,2}\.\d{1,2}%$", w["text"])]
    out = []
    for w in pcts:
        cands = [t for t in ws if 285 <= t["x0"] < w["x0"] - 2
                 and abs(t["top"] - w["top"]) <= 11 and CJK.search(t["text"])]
        if not cands:
            continue
        best = min(cands, key=lambda z: abs(z["top"] - w["top"]))
        lbl = pick_label(best["text"])
        if lbl and 0 < float(w["text"][:-1]) <= 100:
            out.append({"label": lbl, "weight": float(w["text"][:-1])})
    return out


# ---------------- 信安 明智/易富：右栏「資產類別投資分布」数值列 x≈498 ----------------
# 2026-10-19：中文标签常與數值錯行——英文標簽與數值同行，中文在下一行
# （保守/流動基金：「Cash & Short-term Investments」同行、「現金及短期投資(例如:票據及存款)」低 18pt）。
# 放寬到 ±20pt 取最近行，清單括號補充說明。
def alloc_fund_class(pg):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if "資產類別投資分布" in w["text"]]
    if not hd:
        return []
    y0 = hd[0]["top"]
    # 2026-10-19：改用 pair_below 貪心配對。CAP/CAS 版式「現金及短期投資」中文標籤在
    # 數值行下方 ~18pt，舊版「最近標籤」規則讓 50.02/49.98 都配到相鄰的「債券」。
    nums = [w for w in ws if y0 < w["top"] < y0 + 140 and w["x0"] >= 460
            and re.match(r"^\d{1,2}\.\d{1,2}$", w["text"])]
    lbls = [t for t in ws if y0 < t["top"] < y0 + 160 and 325 <= t["x0"] < 460
            and CJK.search(t["text"])]
    out = []
    for n, l in pair_below(nums, lbls, 20):
        lbl = label_of(l["text"])
        if lbl and 0 < float(n["text"]) <= 100:
            out.append({"label": lbl, "weight": float(n["text"])})
    return out


# ---------------- 景順（策略計劃）左栏：数值列 x≈385，中文标签在 x≈238 且常错行 ----------------
# 2026-10-19 重写：舊版把左欄評論文字（x≈25）和「波幅」「基金開支比率」的值當成分佈項，
# 產出 22 只脏數據（合計 1.2~34.3，標籤是「通脹數據則發出不同訊號」這類評論句）。
# 三處修正：標籤限左界 x0≥220（排評論欄）；錯行容忍放到 ±9pt（中文常在數值行上下 3~7pt）；
# 塊尾截斷在下一個欄位標題（風險指標/波幅/開支比率），否則這些值也在同一 x 帶。
IV_LABEL_X0 = 220.0
IV_STOP = ("風險指標", "風險級別", "波幅", "基金開支比率", "主要風險", "基金表現", "基金評論", "曆年回報")


def alloc_iv(pg):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if "資產分佈" in w["text"]]
    if not hd:
        return []
    y0 = min(w["top"] for w in hd)
    stops = [w["top"] for w in ws if any(s in w["text"] for s in IV_STOP) and w["top"] > y0 + 2]
    yend = min(stops) if stops else y0 + 130
    out = []
    for w in ws:
        if not (y0 < w["top"] < yend):
            continue
        if not (360 <= w["x0"] <= 405) or not re.match(r"^\d{1,2}\.\d{1,2}$", w["text"]):
            continue
        ls = [t for t in ws if IV_LABEL_X0 <= t["x0"] < w["x0"] - 3
              and abs(t["top"] - w["top"]) <= 9 and CJK.search(t["text"])]
        if not ls:
            continue
        best = min(ls, key=lambda z: (abs(z["top"] - w["top"]), z["x0"]))
        lbl = clean_label(pick_label(best["text"]))
        if lbl and 0 < float(w["text"]) <= 100:
            out.append({"label": lbl, "weight": float(w["text"])})
    return out


# ---------------- BCT 行業計劃 / 積金之選：右栏「投資組合分布」A/B/C 子行 ----------------
# 保守基金版式：三檔港元倉（A 現金及其他 / B 定期存款 / C 定息證券），
# 中文標籤與百分比同行（x≈255 / x≈383），數值可能為負（-0.3% / -1.1%）。
def alloc_bct_pool(pg):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if "投資組合分布" in w["text"]]
    if not hd:
        return []
    y0 = hd[0]["top"]
    out = []
    for w in ws:
        if not (y0 < w["top"] < y0 + 130):
            continue
        if not (365 <= w["x0"] <= 400) or not re.match(r"^-?\d{1,2}\.\d%$", w["text"]):
            continue
        ls = [t for t in ws if 240 <= t["x0"] < w["x0"] - 3
              and abs(t["top"] - w["top"]) <= 4 and CJK.search(t["text"])]
        if not ls:
            continue
        lbl = label_of(sorted(ls, key=lambda z: z["x0"])[-1]["text"])
        if lbl and -100 < float(w["text"][:-1]) < 100:
            out.append({"label": lbl, "weight": float(w["text"][:-1])})
    return out



# ---------------- 滙豐/恒生：百分比在前的「41.1% 北美股票 North American Equities」 ----------------
def alloc_pct_first(t):
    i = t.find("投資組合分布")
    if i < 0:
        i = t.find("投資組合分佈")      # 2026-10-19：繁體變體（滙豐/恒生 10 月重下載版）
    if i < 0:
        i = t.find("Portfolio allocation")
    if i < 0:
        return []
    seg = t[i:i + 1000]
    out = []
    for v, l in re.findall(r"(\d{1,2}\.\d)%\s*([\u4e00-\u9fff][\u4e00-\u9fff/、 ]*)", seg):
        lbl = l.strip()
        if lbl and 0 < float(v) <= 100:
            out.append({"label": lbl, "weight": float(v)})
    # 去掉重复标签
    seen, res = set(), []
    for x in out:
        if x["label"] in seen:
            continue
        seen.add(x["label"]); res.append(x)
    return res


# ---------------- AMTD：「USD Bonds 美元債券 65.23」英文+中文+裸数字 ----------------
def alloc_amtd(t):
    i = t.find("Portfolio Allocation")
    if i < 0:
        i = t.find("投資組合分佈")
    if i < 0:
        return []
    seg = t[i:i + 1200]
    for stop in ("Remarks", "Top 10", "十大"):
        j = seg.find(stop)
        if j > 0:
            seg = seg[:j]
    out, seen = [], set()
    for line in seg.split("\n")[1:]:
        m = re.match(r"^(.+?)\s+(\d{1,3}\.\d{1,2})$", line.strip())
        if not m:
            continue
        lbl = pick_label(m.group(1))
        if not lbl or lbl in seen:
            continue
        seen.add(lbl)
        if 0 < float(m.group(2)) <= 100:
            out.append({"label": lbl, "weight": float(m.group(2))})
    return out


# ---------------- AMTD：按列解析（2026-10-19 新增） ----------------
# 便覽為雙欄排版：左欄「USD Bonds 美元債券 65.23」，右欄是英文備註，
# extract_text() 會把兩欄拼成一行，舊的「數字必須在行尾」正則全部失配。
# 且數值列的 x 坐標逐頁不同（p4≈276、p16≈225），不能用固定坐標帶。
LEFT_MAX = 300.0        # 左欄右界（右欄備註從 x≈310 起）
ALLOC_STOP = {"Remarks", "備註", "十大", "Top", "Notes", "Note", "註:", "10"}


def alloc_amtd_cols(pg):
    ws = pg.extract_words(x_tolerance=2, y_tolerance=2)
    hd = sorted([w for w in ws if "投資組合分佈" in w["text"] and w["x0"] < 200],
                key=lambda w: w["top"])
    if not hd:
        return []
    y0 = hd[0]["top"]
    left = [w for w in ws if w["x0"] < LEFT_MAX and w["top"] > y0 + 2]
    left.sort(key=lambda w: (round(w["top"], 1), w["x0"]))
    # 按行分組；遇 STOP 詞 / 垂直間隙 >20pt / 超出 y0+150 即斷塊
    lines, cur, lasttop = [], [], None
    for w in left:
        if lasttop is not None and (w["top"] - lasttop > 20 or w["top"] > y0 + 150):
            break
        if lasttop is None or abs(w["top"] - lasttop) <= 4.5:
            cur.append(w)
        else:
            lines.append(cur)
            cur = [w]
        lasttop = w["top"]
    if cur:
        lines.append(cur)
    out = []
    for ln in lines:
        if {w["text"] for w in ln} & ALLOC_STOP:
            break
        for n in [w for w in ln if re.match(r"^\d{1,3}\.\d{1,2}$", w["text"])]:
            cand = [w for w in ln if w["x0"] < n["x0"] - 2 and CJK.search(w["text"])]
            if not cand:
                continue
            lbl = pick_label(cand[-1]["text"])
            v = float(n["text"])
            if lbl and 0 < v <= 100:
                out.append({"label": lbl, "weight": v})
    return out


# ---------------- 新地：「Hong Kong/China Equities 香港/中國股票 24%」 ----------------
def alloc_shkp(t):
    i = t.find("資產分佈")
    if i < 0:
        i = t.find("Asset Allocation")
    if i < 0:
        return []
    seg = t[i:i + 900]
    out, seen = [], set()
    # 2026-10-19：標簽允許括號（亞洲股票(日本除外)、歐洲股票(英國除外)），否則會漏抓
    for v, l in re.findall(r"([\u4e00-\u9fff][\u4e00-\u9fff/ 、（）()]*?)\s*(\d{1,3}(?:\.\d{1,2})?)%", seg):
        lbl = v.strip()
        if not lbl or lbl in seen:
            continue
        # 2026-10-19：便覽尾部有「總數 100%」行，計入會令合計翻倍（197~250）——排除合計行
        if any(k in lbl for k in ("總數", "總計", "合計", "Total")):
            continue
        seen.add(lbl)
        if 0 < float(l) <= 100:
            out.append({"label": lbl, "weight": float(l)})
    return out

def main():
    dry = "--dry" in sys.argv
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    byid = {str(x["id"]): x for x in FN}
    filled = 0

    def put(fid, alloc, src, asof=None, min_items=2):
        nonlocal filled
        v = hld["funds"].get(str(fid)) or {}
        if v.get("alloc") or len(alloc) < min_items:
            return
        # RULES #6：合計不在 70%–106% 一律視為解析失敗，寧缺勿錯。
        # 歷史上部分抓取（只抓到「基本原料」一項，合計 1.20~249.99）就是缺這道校驗。
        tot = sum(x["weight"] for x in alloc)
        if not (70 <= tot <= 106):
            print("  ✗ #%-5s 合計 %.2f 越界，跳過（%s）" % (fid, tot, (byid[fid]["fundBase"])[:24]), flush=True)
            return
        v["alloc"] = alloc
        v["allocLabel"] = "資產分佈"
        if src:
            v["allocSrc"] = src
        hld["funds"][str(fid)] = v
        filled += 1
        print("  ✔ #%-5s %-24s %d 项" % (fid, (byid[fid]["fundBase"])[:24], len(alloc)), flush=True)

    # 1) 信安系三份
    for fn in ("S800_FFS_2026Q2.pdf", "Smart_FFS_2026Q2.pdf", "Simple_FFS_2026Q2.pdf"):
        path = os.path.join(BASE, "tmp", "bct_auto", fn)
        if not os.path.exists(path):
            continue
        plan = "800系列" if fn.startswith("S800") else ("明智之選" if fn.startswith("Smart") else "易富之選")
        pool = [x for x in FN if plan in (x.get("scheme") or "")]
        pdf = pdfplumber.open(path)
        for pi, pg in enumerate(pdf.pages):
            t = pg.extract_text() or ""
            if "投資分布" not in t:
                continue
            nt = norm(t)
            cand = [x for x in pool if norm(x.get("fundBase")) in nt]
            if not cand:
                continue
            a = alloc_xinan(pg)
            if not a and "資產類別投資分布" in t:
                a = alloc_fund_class(pg)
            if a:
                put(cand[0]["id"], a, "信安基金便覽 PDF（%s）" % fn)
        pdf.close()

    # 1b) 策略計劃（景順）月度便覽
    ivp = os.path.join(BASE, "tmp", "bct_auto", "IV_Fact_Sheet.pdf")
    if os.path.exists(ivp):
        pool = [x for x in FN if "策略計劃" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(ivp)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if "資產分佈" not in t:
                continue
            nt = norm(t)
            cand = [x for x in pool if norm(x.get("fundBase")) in nt]
            if not cand:
                continue
            a = alloc_iv(pg)
            if a:
                put(cand[0]["id"], a, "BCT 策略計劃月報 PDF（景順）")
        pdf.close()

    # 1c) 行業計劃 / 積金之選：保守基金右栏「投資組合分布」A/B/C 三檔港元倉
    # 2026-10-19：IS/MTS 便覽（BCT Industry Choice / Pro Choice）
    for fn, plan_kw in (("IS_Fact_Sheet.pdf", "行業計劃"), ("MTS_Fact_Sheet.pdf", "積金之選")):
        bp = os.path.join(BASE, "tmp", "bct_auto", fn)
        if not os.path.exists(bp):
            continue
        pool = [x for x in FN if plan_kw in (x.get("scheme") or "")]
        pdf = pdfplumber.open(bp)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if "投資組合分布" not in t:
                continue
            nt = norm(t)
            cand = [x for x in pool if norm(x.get("fundBase")) in nt]
            if not cand:
                continue
            a = alloc_bct_pool(pg)
            if a:
                put(cand[0]["id"], a, "BCT 官方基金便覽 PDF（%s）" % fn)
        pdf.close()

    # 2c) 中銀保誠（2026-10-19：餅圖引線標簽，值找上方 x 重疊的中文標簽）
    for fn in ("bocpt_ec2.pdf", "bocpt_ec.pdf"):
        bp2 = os.path.join(ARCH, fn)
        if not os.path.exists(bp2):
            continue
        pool = [x for x in FN if "中銀保誠" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(bp2)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if "資產分佈" not in t and "資產配置" not in t:
                continue
            head = " ".join(t.split("\n")[:6])
            cand = [x for x in pool if norm(x.get("fundBase")) in norm(head)]
            if not cand:
                continue
            cand.sort(key=lambda x: -len(norm(x.get("fundBase"))))
            a = alloc_bocpt(pg)
            if a:
                put(cand[0]["id"], a, "中銀保誠基金便覽 PDF（%s）" % fn)
        pdf.close()

    # 2) 東亞（2026-10-19：改用通用坐標解析；標題取頁首 6 行、最長基金名優先）
    bea = os.path.join(ARCH, "bea_ffs.pdf")
    if os.path.exists(bea):
        pool = [x for x in FN if "東亞" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(bea)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if not any(a in t for a in GEN_ANCHORS):
                continue
            head = " ".join(t.split("\n")[:6])
            # 2026-10-20：東亞三套計劃（集成信託/行業計劃/享惠）基金同名，必須按頁首英文計劃名限定範圍
            if "(Industry Scheme)" in head:
                sub = [x for x in pool if "行業計劃" in (x.get("scheme") or "")]
            elif "(MPF)" in head:
                sub = [x for x in pool if "集成信託" in (x.get("scheme") or "")]
            else:
                sub = [x for x in pool if "享惠" in (x.get("scheme") or "")]
            cand = [x for x in (sub or pool) if norm(x.get("fundBase")) in norm(head)]
            if not cand:
                continue
            cand.sort(key=lambda x: -len(norm(x.get("fundBase"))))
            a = alloc_generic(pg)
            if a:
                put(cand[0]["id"], a, "東亞銀行基金概覽 PDF（FFS 2026Q2）")
        pdf.close()

    # 2b) 中國人壽（2026-10-19：標簽在數值行下方 ~10pt，lw=14）
    for fn in ("cl_ffs_2025q3.pdf", "cl_fpr_2026q1.pdf"):
        clp = os.path.join(ARCH, fn)
        if not os.path.exists(clp):
            continue
        pool = [x for x in FN if "中國人壽" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(clp)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if not any(a in t for a in GEN_ANCHORS):
                continue
            head = " ".join(t.split("\n")[:6])
            cand = [x for x in pool if norm(x.get("fundBase")) in norm(head)]
            if not cand:
                continue
            cand.sort(key=lambda x: -len(norm(x.get("fundBase"))))
            a = alloc_generic(pg, 14)
            if a:
                put(cand[0]["id"], a, "中國人壽基金便覽 PDF（%s）" % fn)
        pdf.close()

    # 3) 海通（2026-10-19：改為遍歷 tmp/ht_pdf2 下全部單基金 PDF；每份取第一個分佈頁）
    ht = sorted(glob.glob(os.path.join(BASE, "tmp", "ht_pdf2", "*.pdf")))
    if ht:
        pool = [x for x in FN if "海通" in (x.get("scheme") or "")]
        for hp in ht:
            pdf = pdfplumber.open(hp)
            for pg in pdf.pages:
                t = pg.extract_text() or ""
                if "ASSET ALLOCATION" not in t and "資產分佈" not in t:
                    continue
                # 海通便覽只有「按行業」分佈（ASSET ALLOCATION (BY SECTORS)），非資產類別，跳過
                if "(BY SECTORS)" in t or "資產分佈(行業)" in t or "資產分佈（行業）" in t:
                    break
                # 只用页首前两行做匹配（正文评论里会提到别的基金名，容易串号）
                head = " ".join([l for l in t.split("\n")[:2]])
                nt = norm(head)
                cand = [x for x in pool if norm(x.get("fundBase")) in nt]
                if not cand:
                    continue
                a = alloc_haitong(pg)
                if a:
                    put(cand[0]["id"], a, "海通國際基金概覽 PDF（%s）" % os.path.basename(hp))
                break   # 每份 PDF 只取第一个分佈页
            pdf.close()

    # 4) 滙豐 / 恒生（兩份概覽 PDF；「41.1% 北美股票 North American Equities」）
    for fn, plan_kw in (("hsbc_ffs.pdf", "滙豐"), ("hase_ffs.pdf", "恒生")):
        path = os.path.join(BASE, "tmp", fn)
        if not os.path.exists(path):
            continue
        pool = [x for x in FN if plan_kw in (x.get("scheme") or "")]
        pdf = pdfplumber.open(path)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            # 2026-10-19：兼容繁體「投資組合分佈」（10 月重下載的滙豐/恒生便覽）
            if "投資組合分布" not in t and "投資組合分佈" not in t:
                continue
            head = " ".join(t.split("\n")[:4])
            cand = [x for x in pool if norm(x.get("fundBase")) in norm(head)]
            if not cand:
                cand = [x for x in pool if norm(x.get("fundBase")) in norm(t)]
            if not cand:
                continue
            # 同名前缀（均衡基金 vs 智優逸均衡基金）→ 取最长匹配
            cand.sort(key=lambda x: -len(norm(x.get("fundBase"))))
            a = alloc_pct_first(t)
            if a:
                put(cand[0]["id"], a, "滙豐/恒生 基金概覽 PDF")
        pdf.close()

    # 5) AMTD（安聯）—— 每頁一隻，頁首第 4 行為中文基金名
    amtd = os.path.join(ARCH, "amtd_ffs_mpfa.pdf")
    if os.path.exists(amtd):
        pool = [x for x in FN if "AMTD" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(amtd)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if "Portfolio Allocation" not in t and "投資組合分佈" not in t:
                continue
            head = " ".join(t.split("\n")[:5])
            cand = [x for x in pool if norm(x.get("fundBase")) in norm(head)]
            if not cand:
                cand = [x for x in pool if norm(x.get("fundBase")) in norm(t)]
            if not cand:
                continue
            cand.sort(key=lambda x: -len(norm(x.get("fundBase"))))
            a = alloc_amtd_cols(pg) or alloc_amtd(t)   # 2026-10-19：優先按列解析（雙欄排版）
            if a:
                put(cand[0]["id"], a, "AMTD 基金便覽 PDF（2025-12）")
        pdf.close()

    # 6) 新地（SHKP）
    shkp = os.path.join(ARCH, "shkp_ffs.pdf")
    if os.path.exists(shkp):
        pool = [x for x in FN if "新地" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(shkp)
        for pg in pdf.pages:
            t = pg.extract_text() or ""
            if "資產分佈" not in t:
                continue
            # 2026-10-19: SHKP 便覽頁首是固定抬頭，改按「基金名在頁面出現次數」判定
            nt = norm(t)
            cand = [x for x in pool if norm(x.get("fundBase")) in nt]
            if not cand:
                continue
            cand.sort(key=lambda x: (-nt.count(norm(x.get("fundBase"))), -len(norm(x.get("fundBase")))))
            # 單頁單基金的便覽：出現 1 次即可（長名優先）
            a = alloc_shkp(t)
            # 2026-10-19：過濾「最高股票比重/上限」類說明行與 3 字以下碎片標簽；
            # 便覽是小型文字表，合計必須≈100 才收（95–101），否則寧缺勿錯
            a = [x for x in a if not any(k in x["label"] for k in ("最高", "比重", "上限", "下限", "最多", "約佔"))]
            if a and not (95 <= sum(x["weight"] for x in a) <= 101):
                # 便覽偶有碎片標簽（如「類股票」重複行）：嘗試移除單項後合計落回 95–101
                for i in range(len(a)):
                    cand2 = a[:i] + a[i + 1:]
                    if cand2 and 95 <= sum(x["weight"] for x in cand2) <= 101:
                        a = cand2
                        break
            if a and 95 <= sum(x["weight"] for x in a) <= 101:
                put(cand[0]["id"], a, "新地強積金基金概覽 PDF（SHKP）")
        pdf.close()

    # 8) 交通銀行（BCOM）：右栏「資產分佈」柱狀圖標簽，坐標解析
    # 2026-10-19：保守基金（p1）僅「銀行存款 100.0%」一項，屬完整數據，min_items=1
    bocom = os.path.join(ARCH, "bocom_ffs_2026q2.pdf")
    if os.path.exists(bocom):
        pool = [x for x in FN if "交通銀行" in (x.get("scheme") or "")]
        pdf = pdfplumber.open(bocom)
        for pg in pdf.pages:
            for blk in alloc_bocom(pg):
                nt = norm(blk["title"])
                if not nt:
                    continue
                cand = [x for x in pool if norm(x.get("fundBase")) in nt]
                if not cand:
                    # 字體缺字回退：恒指ESG 頁標題缺「恒」字 → 最長公共子串 ≥8 且唯一
                    scored = [(x, _lcs_len(norm(x.get("fundBase")), nt)) for x in pool]
                    scored = [t for t in scored if t[1] >= 8]
                    scored.sort(key=lambda t: -t[1])
                    if len(scored) == 1 or (scored and scored[0][1] > scored[1][1]):
                        cand = [scored[0][0]]
                if len(cand) != 1:
                    continue
                if blk["items"]:
                    put(cand[0]["id"], blk["items"], "交通銀行基金便覽 PDF（2026Q2）",
                        min_items=1)
        pdf.close()

    # 7) 同计划同名（A/H 单位类别）共用同一资产分布
    grp = {}
    for x in FN:
        k = (x.get("scheme") or "", norm(x.get("fundBase")))
        grp.setdefault(k, []).append(str(x["id"]))
    for k, ids in grp.items():
        donor = next((i for i in ids if (hld["funds"].get(i) or {}).get("alloc")), None)
        if not donor:
            continue
        for i in ids:
            v = hld["funds"].get(i) or {}
            if not v.get("alloc"):
                v["alloc"] = [dict(z) for z in hld["funds"][donor]["alloc"]]
                v["allocLabel"] = hld["funds"][donor].get("allocLabel") or "資產分佈"
                v["allocSrc"] = "同計劃同基金（單位類別共用）"
                hld["funds"][i] = v
                filled += 1

    if not dry:
        hld["count"] = len(hld["funds"])
        hld["updatedAt"] = int(time.time() * 1000)
        json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("补入 %d 只；有资产分布 %d / %d" % (
        filled, sum(1 for v in hld["funds"].values() if v.get("alloc")), len(hld["funds"])))


if __name__ == "__main__":
    main()
