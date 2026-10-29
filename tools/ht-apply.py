# -*- coding: utf-8 -*-
"""海通國際「基金概覽」月度汇总 PDF → holdings.json（持仓 + 资产分布）

背景（2026-10-28 打通）：
  * 海通 MPF 官网已迁到 http://www.haitongetf.com.hk/mpf/zh-cht
    （旧域名 www.haitong.com.hk 在本机 DNS 不解析，curl exit 6）。
  * 7 只基金共用同一份 6 页汇总 PDF（任取一只的「基金概覽」链接内容相同），
    2026-09 版实测 1,085,123B，文内「截至30/09/2026」。
  * 每只基金一个面板：ASSET ALLOCATION 在 TOP TEN 之前 → 用「本面板 TOP 之上、
    上一面板 TOP 之下」的 ASSET 锚点配对，否则会串到下一只基金的分布。
  * 百分比常被拆成单字符（"3" "." "0" "2" "%"），必须按水平邻接合并后再校验。

用法：
  python tools/ht-apply.py                 # 干跑，打印核对表（不写库）
  python tools/ht-apply.py --write         # 写库
  python tools/ht-apply.py --pdf X.pdf     # 指定 PDF
PDF 默认读 tmp/ht_pdf3/Haitong_Korea_Fund.pdf。
注意：跑完请删除该 PDF，否则 ht_holdings3.py（asOf 硬编码）会把它重写成旧日期。
"""
import json
import os
import re
import sys
import time

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
import pdfplumber            # noqa: E402
import ht_holdings3 as h3    # noqa: E402
import ht_holdings2 as h2    # noqa: E402

HOLD = os.path.join(BASE, "data", "holdings.json")
DEF_PDF = os.path.join(BASE, "tmp", "ht_pdf3", "Haitong_Korea_Fund.pdf")
SKIP = re.compile(r"資產分佈|COUNTRY|REGION|ASSET|ALLOCATION|十大|持股")
PCT = re.compile(r"^\d{1,3}\.\d{1,2}%$")


def alloc_at(pg, y0, ymax=None):
    """解析一个 ASSET ALLOCATION 区块：百分比碎片水平合并，标签取 y 邻域内中文词。"""
    ws = [w for w in pg.extract_words(x_tolerance=2)
          if y0 + 6 <= w["top"] <= (ymax or y0 + 210)]
    nums = sorted([w for w in ws if w["x0"] >= 315 and re.match(r"^[\d.%]+$", w["text"])],
                  key=lambda w: (w["top"], w["x0"]))
    groups = []
    for w in nums:                       # 碎片合并：同一行、x 间距极小
        if groups and abs(w["top"] - groups[-1][-1]["top"]) <= 2.5 \
                and -3 < w["x0"] - groups[-1][-1]["x1"] < 12:
            groups[-1].append(w)
        else:
            groups.append([w])
    out, seen = [], set()
    for g in groups:
        txt = "".join(w["text"] for w in g)
        if not PCT.match(txt):
            continue
        y = sum(w["top"] for w in g) / len(g)
        near = [w for w in ws if 280 <= w["x0"] < 470 and abs(w["top"] - y) <= 9
                and re.search(r"[\u4e00-\u9fff]", w["text"])]
        if not near:
            continue
        best = min(near, key=lambda w: abs(w["top"] - y))
        line = [w for w in near if abs(w["top"] - best["top"]) <= 2.5]
        zh = re.sub(r"[\^＊*]+", "", "".join(w["text"] for w in sorted(line, key=lambda z: z["x0"])))
        if len(zh) < 2 or len(zh) > 12 or SKIP.search(zh) or zh in seen:
            continue
        seen.add(zh)
        out.append({"label": zh, "weight": float(txt.rstrip("%"))})
    return out


def asof_of_pdf(pdf):
    txt = "\n".join((p.extract_text() or "") for p in pdf.pages[:3])
    m = re.search(r"截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日", txt)
    if m:
        return "%04d-%02d-%02d" % (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.search(r"截至\s*(\d{2})/(\d{2})/(\d{4})", txt)
    if m:
        return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    return None


def main():
    args = sys.argv[1:]
    path = args[args.index("--pdf") + 1] if "--pdf" in args else DEF_PDF
    write = "--write" in args
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(BASE, "data", "funds.json"), encoding="utf-8"))["funds"]
    ht = [x for x in FN if "海通" in (x.get("scheme") or "")]

    pdf = pdfplumber.open(path)
    asof = asof_of_pdf(pdf)
    if not asof:
        print("!! 未能从 PDF 识别截止日，停止")
        sys.exit(2)
    src = "海通國際基金概覽 PDF（%s，逐基金頁）" % asof

    panels = []
    for pi, pg in enumerate(pdf.pages):
        titles = h3.page_titles(pg)
        words = pg.extract_words(x_tolerance=3)
        topt = [ty for ty in sorted({round(w["top"]) for w in words if w["text"] in ("TOP", "Top")})
                if h3.parse_block(words, ty)]
        if not topt:
            continue
        ays = sorted({round(w["top"]) for w in words if w["text"].upper() == "ASSET" and any(
            x["text"].upper().startswith("ALLOC") and abs(x["top"] - w["top"]) < 4 for x in words)})
        for bi, ty in enumerate(topt):
            b = h3.parse_block(words, ty)
            for r in b:                  # 洗掉存款/债券名称里的 △ 利率与 ※ 日期标记
                r["name"] = h2.clean_hold_name(r["name"])[:46] or r["name"]
            if len(b) < 3:
                continue
            nm = titles[bi][1] if bi < len(titles) else h3.guess_by_content(b)
            prev = topt[bi - 1] if bi > 0 else 0
            cand = [y for y in ays if prev < y < ty]
            al = alloc_at(pg, cand[0]) if cand else []
            panels.append((nm, b, al, sum(x["weight"] for x in al), pi + 1))

    print("海通清单 %d 条 | 截止日 %s | 解析面板 %d 个\n" % (len(ht), asof, len(panels)))
    if len(panels) != 7:
        print("!! 面板数异常（应为 7），停止")
        sys.exit(2)
    bad = 0
    for nm, b, al, sm, pg in panels:
        ok = 98.5 <= sm <= 101.5 and len(al) >= 2
        bad += 0 if ok else 1
        print("  p%-2d %-14s top=%-2d 首行 %-24s %5.2f | alloc %s n=%d sum=%.1f" % (
            pg, nm, len(b), b[0]["name"][:24], b[0]["weight"],
            "采用" if ok else "沿用旧", len(al), sm))
    if not write:
        print("\n（干跑：未写库，%d 个面板分布将沿用旧值）" % bad)
        pdf.close()
        return

    n = 0
    for nm, b, al, sm, pg in panels:
        core = h3.NAME_MAP.get(nm)
        if not core:
            print("✘ 未映射:", nm)
            continue
        ok = 98.5 <= sm <= 101.5 and len(al) >= 2
        for x in [y for y in ht if core in (y.get("fundBase") or y.get("fund") or "")]:
            old = hld["funds"].get(str(x["id"])) or {}
            hld["funds"][str(x["id"])] = {
                "asOf": asof, "src": src, "top10": b,
                "alloc": (al if ok else (old.get("alloc") or [])),
                "allocLabel": "資產分佈" if (ok or old.get("alloc")) else None,
            }
            n += 1
    hld["count"] = len(hld["funds"])
    hld["updatedAt"] = int(time.time() * 1000)
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("\n写入 %d 条" % n)
    pdf.close()


if __name__ == "__main__":
    main()
