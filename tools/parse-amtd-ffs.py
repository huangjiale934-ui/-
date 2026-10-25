# -*- coding: utf-8 -*-
"""AMTD 季度基金便覽解析（tools/parse-amtd-ffs.py）
====================================================================
输入：tmp/amtd/<slug>.pdf（由 tools/amtd-fetch-chrome.js 从 Google Drive 下载）
输出：--write 时写回 data/holdings.json；否则只打印与 tmp/amtd/parsed.json

PDF 版式（2026-Q2 实测，Invesco / Allianz 两套模板同构）：
  第 2 页：基金中英文名 → "As at 30-Jun-2026 截至2026 年6 月30 日"
           → "Portfolio Allocation 投資組合分佈 (%)" 标签若干行，随后同数量的百分比
           → "Top 10 Portfolio Holdings 投資組合內十大資產 (%)" 名称若干行，随后同数量的百分比
  第 3 页：风险级别说明（忽略）

用法：
  python tools/parse-amtd-ffs.py            # 只解析、打印
  python tools/parse-amtd-ffs.py --write    # 解析并写回 holdings.json
"""
import glob
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
SRC_DIR = os.path.join(BASE, "tmp", "amtd")
SRC = "AMTD 每季基金概覽 PDF（Google Drive，季度）"

NUM = re.compile(r"^-?\d+(?:\.\d+)?$")
ZH_LABEL = re.compile(r"([\u4e00-\u9fff][\u4e00-\u9fff（）()、／/·\-－ &]*?)\s*\d*$")


def norm(s):
    """名称归一：去尾部脚注数字/空白/括号内容，便于与 funds.json 匹配（保留 2028/2038 等年份数字）"""
    s = (s or "").strip()
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    s = re.sub(r"[\d,\s]+$", "", s)
    return re.sub(r"[\s\u3000]", "", s).strip()


def split_block(seg):
    """标签行 + 数值行 → (labels, values)"""
    lines = [l.strip() for l in seg.split("\n") if l.strip()]
    if not lines:
        return [], []
    body = lines[1:]  # 去掉块标题
    k = None
    for i, l in enumerate(body):
        if NUM.match(l):
            k = i
            break
    if k is None:
        return [], []
    return body[:k], [float(x) for x in body[k:]]


def parse_one(path):
    d = pymupdf.open(path)
    # 页序不固定（部分 PDF 夹空白页），按内容定位基金页
    txt = None
    for i in range(d.page_count):
        t = d[i].get_text()
        if "As at" in t and "Top 10 Portfolio Holdings" in t:
            txt = t
            break
    if txt is None:
        raise ValueError("找不到基金页（As at / Top 10 缺失）")
    m = re.search(r"As at\s*(\d{1,2})-([A-Za-z]{3})-(\d{4})", txt)
    if not m:
        raise ValueError("找不到 As at 日期")
    mon = {v: i for i, v in enumerate(
        "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(), 1)}
    asof = "%s-%02d-%02d" % (m.group(3), mon[m.group(2)], int(m.group(1)))

    zh_name = ""
    cands = []
    for line in txt.split("\n")[:10]:
        s = line.strip()
        if re.match(r"^AMTD\s*[\u4e00-\u9fff]", s):
            cands.append(re.sub(r"[\d,\s]+$", "", s))
    # 第 1 条是计划名「AMTD 強積金計劃」，基金名在其后
    for c in cands:
        if "強積金計劃" not in c:
            zh_name = c
            break
    if not zh_name and cands:
        zh_name = cands[-1]
    if not zh_name:
        raise ValueError("找不到基金中文名")

    i1 = txt.find("Portfolio Allocation")
    i2 = txt.find("Top 10 Portfolio Holdings")
    i3 = txt.find("Fund Details")
    if min(i1, i2, i3) < 0:
        raise ValueError("区块标题缺失")
    a_labels, a_vals = split_block(txt[i1:i2])
    t_names, t_vals = split_block(txt[i2:i3])

    # 分布标签只留中文
    alloc = []
    for lb, w in zip(a_labels, a_vals):
        mm = ZH_LABEL.search(lb)
        alloc.append({"label": (mm.group(1).strip() if mm else lb), "weight": round(w, 2)})

    # 名称多余行（折行）合并到上一条
    if len(t_names) > len(t_vals):
        extra = len(t_names) - len(t_vals)
        merged = []
        i = 0
        while i < len(t_names):
            if i < extra:
                merged.append(t_names[i] + " " + t_names[i + 1])
                i += 2
            else:
                merged.append(t_names[i])
                i += 1
        t_names = merged
    top10 = [{"name": n.strip()[:60], "weight": round(w, 2)}
             for n, w in zip(t_names, t_vals)][:10]

    return {
        "file": os.path.basename(path),
        "zh_name": zh_name,
        "asOf": asof,
        "top10": top10,
        "alloc": alloc,
        "allocSum": round(sum(a["weight"] for a in alloc), 2),
        "topSum": round(sum(t["weight"] for t in top10), 2),
    }


def main():
    write = "--write" in sys.argv
    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))
    flist = funds if isinstance(funds, list) else funds.get("funds", [])
    idx = {}
    for f in flist:
        k = norm(f.get("fundBase") or f.get("fund") or "")
        if k:
            idx[k] = f

    out = []
    unmatched = []
    for p in sorted(glob.glob(os.path.join(SRC_DIR, "*.pdf"))):
        try:
            r = parse_one(p)
        except Exception as e:
            print("✗ %-24s %s" % (os.path.basename(p), e))
            continue
        f = idx.get(norm(r["zh_name"]))
        r["id"] = str(f["id"]) if f else None
        if not f:
            unmatched.append((r["file"], r["zh_name"]))
        out.append(r)

    for r in out:
        flag = "" if r["id"] else "  ← 未匹配"
        warn = ""
        if abs(r["allocSum"] - 100) > 0.5:
            warn += " [分布合计 %.2f]" % r["allocSum"]
        if len(r["top10"]) != 10:
            warn += " [top10=%d]" % len(r["top10"])
        print("%-24s → id=%-5s %-22s asOf=%s top=%2d 分布=%2d 合计=%.2f%s%s"
              % (r["file"], r["id"] or "?", r["zh_name"][:22], r["asOf"], len(r["top10"]),
                 len(r["alloc"]), r["allocSum"], flag, warn))

    if unmatched:
        print("\n未匹配到 funds.json 的：")
        for f, n in unmatched:
            print("  ", f, "|", n)

    json.dump(out, open(os.path.join(SRC_DIR, "parsed.json"), "w", encoding="utf-8"),
              ensure_ascii=False, indent=1)

    if not write:
        print("\n（未写库；加 --write 才写入 holdings.json）")
        return

    h = json.load(open(HOLD, encoding="utf-8"))
    n = 0
    for r in out:
        if not r["id"]:
            continue
        v = h["funds"].setdefault(r["id"], {})
        v["asOf"] = r["asOf"]
        v["top10"] = r["top10"]
        v["alloc"] = r["alloc"]
        v["src"] = SRC
        v["allocLabel"] = "投資組合分佈"
        v["allocTitle"] = "投資組合分布"
        v["allocSum"] = r["allocSum"]
        v["allocIncomplete"] = abs(r["allocSum"] - 100) > 0.5
        v.pop("srcStatus", None)
        v.pop("srcNote", None)
        n += 1
    h["updatedAt"] = int(__import__("time").time() * 1000)
    json.dump(h, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False)
    print("\n已写回 holdings.json：%d 只" % n)


if __name__ == "__main__":
    main()
