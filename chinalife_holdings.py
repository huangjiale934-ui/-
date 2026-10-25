# -*- coding: utf-8 -*-
"""中国人寿持仓解析 v2（chinalife_holdings.py）—— 每页最多 2 只基金
====================================================================
用户指正（2026-10-19）：FPR 季报**每页含两处「Top 10 Portfolio Holdings」**（上半+下半各一只），
旧版只取第一处 → 10 只只覆盖 6 只。现改为遍历页内**所有** Top 区块：
  区块 ↔ 上方最近的中文「中國人壽XX基金」名（排除说明句）。
p2: 大中華+美國 / p3: 香港+樂休閒環球 / p4: 增長+平衡 / p5: 核心累積+65歲後 / p6: 樂安心 / p7: 保守 = 10 只全覆盖。
用法：python chinalife_holdings.py tmp/cl_fpr_2026q1.pdf [tmp/cl_ffs_2025q3.pdf ...]
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

BAD = ("不保證", "計劃中", "注意", "說明")


def fund_names(words):
    """页内所有基金名（按 y 聚合同行的中文词，兼容名称被拆成多词）"""
    from collections import defaultdict
    rows = defaultdict(list)
    for w in words:
        rows[round(w["top"])].append(w)
    out = []
    for y in sorted(rows):
        ws = sorted(rows[y], key=lambda w: w["x0"])
        # 只取左侧区域（x<320）的中文词拼接
        seg = "".join(w["text"] for w in ws if w["x0"] < 320 and any("\u4e00" <= ch <= "\u9fff" for ch in w["text"]))
        seg = seg.replace(" ", "")
        mm = re.search(r"中國人壽[\u4e00-\u9fff0-9]+?基金", seg)
        if mm and not any(b in mm.group(0) for b in BAD):
            out.append((y, mm.group(0)))
    return out


def parse_block(words, ty, y_end):
    """解析一个 TOP 区块：名称（英文+中文）+ 百分比（行末）"""
    zone = [w for w in words if ty + 10 <= w["top"] <= y_end]
    rows = {}
    for w in zone:
        rows.setdefault(round(w["top"]), []).append(w)
    top10 = []
    for k in sorted(rows):
        ws = sorted(rows[k], key=lambda w: w["x0"])
        # 权重：行内百分比词中「最右侧」的一列（x≈517 持仓权重列）。
        # 2026-10-24 修 P0：债券行格式为「名称 @291 | 票面利率 @352 | S/A 到期日 | 权重 @517」，
        # 旧代码取行内第一个百分比 → 把票面利率当成了权重（603 乐安心 WELLS 4.97 实为利率，
        # 真实权重 2.48）。取最右列即权重。
        pcts = [w for w in ws if re.match(r"^\d+\.\d+%$", w["text"])]
        if not pcts:
            continue
        pcts.sort(key=lambda w: w["x0"])
        wv = pcts[-1]          # 最右百分比 = 持仓权重
        rate_x = pcts[0]["x0"]  # 最左百分比（若有）= 票面利率列
        # 名称：同一行 x 小于利率列的英文/中文（剔除图表轴数字与利率/到期日）
        nm_parts = []
        for w in ws:
            if w["x0"] < rate_x - 2 and not re.match(r"^[\d\.,%]+$", w["text"]):
                nm_parts.append(w["text"])
        nm = " ".join(nm_parts).strip()
        # 去掉行首的图表刻度数字（如 "13.5000"）
        nm = re.sub(r"^\d+(\.\d+)?\s*", "", nm)
        if nm and len(nm) >= 2:
            top10.append({"name": nm[:56], "weight": float(wv["text"].rstrip("%"))})
        if len(top10) >= 10:
            break
    return top10


def parse_allocs(words, tys, page_h):
    """解析每个基金区块的 Portfolio Allocation（右栏 x>300；名称=百分比左侧最近中文）"""
    al_ys = sorted(set(round(w["top"]) for w in words if w["text"] == "Portfolio" and w["x0"] > 250))
    out = []
    for ai, ay in enumerate(al_ys):
        y_end = al_ys[ai + 1] - 3 if ai + 1 < len(al_ys) else page_h
        zone = [w for w in words if ay - 2 <= w["top"] <= min(ay + 70, y_end) and w["x0"] > 300]
        rows = {}
        for w in zone:
            rows.setdefault(round(w["top"]), []).append(w)
        items = []
        for k in sorted(rows):
            ws = sorted(rows[k], key=lambda w: w["x0"])
            for pw in ws:
                # 2026-10-19：中文与百分比可能合并成词（如「股票21.18%」）→ 词尾匹配
                m = re.match(r"^(.*?)(\d+\.\d+)%$", pw["text"])
                if not m:
                    continue
                inline_zh = m.group(1).strip() if re.search(r"[\u4e00-\u9fff]", m.group(1) or "") else ""
                pctv = float(m.group(2))
                zh = []
                for k2 in (k - 2, k - 1, k, k + 1, k + 2):
                    for w in rows.get(k2, []):
                        if pw["x0"] - 140 <= w["x0"] < pw["x0"] and re.search(r"[\u4e00-\u9fff]", w["text"]):
                            tx = re.sub(r"\d+\.\d+%$", "", w["text"])
                            if tx and tx not in zh:
                                zh.append(tx)
                if inline_zh:
                    zh = [inline_zh] + [z for z in zh if z != inline_zh]
                lbl = "".join(zh).strip()
                if lbl and 2 <= len(lbl) <= 10:
                    items.append({"label": lbl, "weight": pctv})
        # 去重
        seen = set()
        items2 = []
        for it in items:
            if it["label"] not in seen:
                seen.add(it["label"])
                items2.append(it)
        if items2:
            out.append(items2)
    return out


def main():
    paths = sys.argv[1:] or [os.path.join(BASE, "tmp", "cl_fpr_2026q1.pdf")]
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    cl = [x for x in FN if "中國人壽" in (x.get("trustee") or "") or "中國人壽" in (x.get("scheme") or "")]
    total = 0
    for path in paths:
        if not os.path.exists(path):
            print("✘ 不存在:", path)
            continue
        base = os.path.basename(path).lower()
        m = re.search(r"(20\d{2})q(\d)", base)
        asof = None
        if m:
            yy, qq = int(m.group(1)), int(m.group(2))
            asof = "%d-%02d-%02d" % (yy, qq * 3, [31, 30, 30, 31][qq - 1])
        pdf = pdfplumber.open(path)
        # 2026-10-24：MPFA 汇总版文件名不含季度（如 MT00083.pdf），改从首页「As at 30 June 2026」取
        if not asof:
            try:
                import pymupdf as _fitz
                _d = _fitz.open(path)
                _p1 = _d[0].get_text()
                _d.close()
                _months = "January February March April May June July August September October November December".split()
                best = None
                for _mm in re.finditer(r"As at\s*(\d{1,2})\s+([A-Za-z]{3,9})\s+(20\d{2})", _p1):
                    _k = _mm.group(2)[:3].lower()
                    _mi = next((i for i, v in enumerate(_months, 1) if v[:3].lower() == _k), 0)
                    if _mi and int(_mm.group(3)) >= 2020:
                        best = (_mm.group(3), _mi, int(_mm.group(1)))
                if best:
                    asof = "%s-%02d-%02d" % best
            except Exception:
                pass
        if not asof:
            print("X 无法确定报告期，跳过:", path)
            continue
        for pi, pg in enumerate(pdf.pages):
            words = pg.extract_words(x_tolerance=3)
            tys = sorted(set(round(w["top"]) for w in words if w["text"] == "Top"))
            if not tys:
                continue
            names = fund_names(words)
            page_h = max(w["top"] for w in words) if words else 800
            allocs = parse_allocs(words, tys, page_h)
            # 去重保序（同一名称可能被拆分多词）
            seen_nm = []
            for _, n in names:
                if n not in seen_nm:
                    seen_nm.append(n)
            for bi, ty in enumerate(tys):
                y_end = (tys[bi + 1] - 5) if bi + 1 < len(tys) else page_h
                # 2026-10-19 修复：按页内名称顺序配对（区块2 的中文标题可能在区块下方，上方最近会误取区块1 的名称）
                if bi < len(seen_nm):
                    fname = seen_nm[bi]
                else:
                    above = [(y, n) for y, n in names if y < ty - 5]
                    if not above:
                        continue
                    fname = max(above, key=lambda x: x[0])[1]
                top10 = parse_block(words, ty, y_end)
                if len(top10) < 2:
                    continue
                core = fname.replace("中國人壽", "").replace("基金", "").strip()
                x = None
                for v in cl:
                    fb = (v.get("fundBase") or v.get("fund") or "").replace("中國人壽", "").replace("基金", "").replace(" ", "")
                    core_c = core.replace(" ", "")
                    if core_c and (core_c == fb or core_c in fb or fb in core_c):
                        x = v
                        break
                if not x:
                    print("✘ p%d 未匹配: %s core=%s" % (pi + 1, fname, core))
                    continue
                old = hld["funds"].get(str(x["id"]))
                if old and old.get("asOf") and asof and old["asOf"] > asof:
                    continue
                al = allocs[bi] if bi < len(allocs) else []
                _new = {
                    "asOf": asof,
                    "src": "中國人壽信託基金表現季報 PDF（FPR，季度）",
                    "top10": top10,
                    "alloc": al,
                    "allocLabel": "投資組合分佈" if al else None,
                }
                # 2026-10-24 防退化：舊記錄 alloc 項數更多時保留（FPR 分布區文字層混亂，
                # 部分頁解析不出會寫空——與 sunlife --force 同類教訓）
                if old and len(old.get("alloc") or []) > len(al):
                    _new["alloc"] = old["alloc"]
                    _new["allocLabel"] = old.get("allocLabel")
                    for _k in ("allocSum", "allocIncomplete", "allocTitle", "allocSrc"):
                        if _k in old:
                            _new[_k] = old[_k]
                hld["funds"][str(x["id"])] = _new
                total += 1
                print("✔ p%d #%s %s top10=%d 首行=%s %.2f" % (
                    pi + 1, x["id"], fname[:18], len(top10), top10[0]["name"][:24], top10[0]["weight"]), flush=True)
        pdf.close()
    hld["count"] = len(hld["funds"])
    hld["updatedAt"] = int(time.time() * 1000)
    srcs = set()
    for v in hld["funds"].values():
        if v.get("src"):
            srcs.add(v["src"].split("（")[0])
    hld["source"] = " + ".join(sorted(srcs))
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：写入 %d；holdings 共 %d" % (total, hld["count"]))


if __name__ == "__main__":
    main()
