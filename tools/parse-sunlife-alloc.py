# -*- coding: utf-8 -*-
"""永明（Sun Life）季报「投資組合分布」读图入库 —— 2026-11-26
=====================================================================
背景：SLR_MPF_Quarterly_Update.pdf 的饼图与图例在 PDF 里是**图片**（无文字层），
      旧做法 `sunlife_alloc_ingest.py` 是人工逐页读图、ASOF 写死。
      本脚本用 300dpi 渲染 + RapidOCR 读图例，数字来自 OCR，标签优先复用上一季
      已核对的词表（避免 OCR 少字导致标签漂移）。

校验（不过就不写）：
  1) 每只基金分布的百分比合计 ∈ [99.5, 100.5]；
  2) 条目数 ≥ 2 且标签去重后不塌缩；
  3) PDF 内文日期必须等于 --asof（默认 2026-09-30），否则整批拒写。

用法：
  python tools/parse-sunlife-alloc.py tmp/slr_mpf.pdf            # 只打印核对表
  python tools/parse-sunlife-alloc.py tmp/slr_mpf.pdf --write     # 写回 holdings.json
"""
import argparse
import difflib
import io
import json
import os
import re
import sys
import time

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, "data", "holdings.json")
IMGDIR = os.path.join(BASE, "tmp", "slr_alloc")
os.makedirs(IMGDIR, exist_ok=True)

PDF = None
ASOF = "2026-09-30"
SRC_OLD = "永明彩虹強積金計劃季報 PDF（SLR，季度）"


def load_map():
    """复用静态录入脚本里的 基金名 → ids / 上一季标签 映射（只读，不执行 main）。"""
    import importlib.util
    p = os.path.join(BASE, "sunlife_alloc_ingest.py")
    spec = importlib.util.spec_from_file_location("slai", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m.DATA


def clean_label(s):
    s = re.sub(r"[A-Za-z0-9&/\\\-–—.,'’\"()（）：:]+", "", s or "")
    s = re.sub(r"\s+", "", s)
    s = s.replace("投資组合分布", "").replace("投資組合分布", "")
    return s.strip()


def pick_label(raw, vocab):
    """把 OCR 出来的「中文+英文」串对齐到上一季词表；对不上就保留清洗后的中文。"""
    c = clean_label(raw)
    if not c:
        return None
    best, score = None, 0.0
    for v in vocab:
        r = difflib.SequenceMatcher(None, c, v).ratio()
        if r > score:
            best, score = v, r
    if score >= 0.62:
        return best
    return c


def ocr_lines(png):
    from rapidocr_onnxruntime import RapidOCR
    global _ENGINE
    try:
        eng = _ENGINE
    except NameError:
        _ENGINE = eng = RapidOCR()
    res, _ = eng(png)
    out = []
    for box, txt, score in (res or []):
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        out.append({"y": sum(ys) / 4.0, "x": min(xs), "t": txt, "s": float(score)})
    out.sort(key=lambda r: (r["y"], r["x"]))
    return out


PCT = re.compile(r"(\d{1,3}(?:\.\d)?)\s*%")


def parse_page(pg, vocab):
    txt = pg.get_text()
    name = None
    for l in txt.split("\n"):
        m = re.match(r"^(永明[\u4e00-\u9fffA-Za-z0-9 ]+?基金)\s*$", l.strip())
        if m:
            name = m.group(1).strip()
            break
    a = pg.search_for("投資組合分布") or pg.search_for("投資组合分布")
    b = pg.search_for("十大主要證券")
    if not (name and a and b):
        return None
    y0 = max(a[0].y0, 0)
    y1 = min(x.y0 for x in b if x.y0 > y0) if any(x.y0 > y0 for x in b) else y0 + 120
    # 分布区块固定在右栏（x≈318 起），左栏是基金表现表，必须裁掉，否则百分比串行
    clip = pymupdf.Rect(300, y0 - 2, pg.rect.width - 14, min(y1 + 2, pg.rect.height))
    png = os.path.join(IMGDIR, re.sub(r"[^\w\u4e00-\u9fff]+", "_", name) + ".png")
    pg.get_pixmap(clip=clip, dpi=300).save(png)
    boxes = ocr_lines(png)
    # 同一行的「标签框」与「百分比框」是分开的：按 y 聚类后配对
    clusters = []
    for b in boxes:
        if clusters and abs(b["y"] - clusters[-1][0]["y"]) <= 14:
            clusters[-1].append(b)
        else:
            clusters.append([b])
    rows = []
    for cl in clusters:
        pcts = [b for b in cl if PCT.fullmatch(b["t"].strip().replace(" ", ""))]
        if not pcts:
            continue
        p = max(pcts, key=lambda b: b["x"])
        pct = float(PCT.fullmatch(p["t"].strip().replace(" ", "")).group(1))
        labs = [b["t"] for b in cl if b is not p and b["x"] < p["x"] and re.search(r"[\u4e00-\u9fff]", b["t"])]
        lab = pick_label("".join(labs), vocab)
        if lab:
            rows.append({"label": lab, "weight": pct, "y": p["y"], "raw": "|".join(b["t"] for b in cl)})
    # 同标签只留第一个（OCR 偶发重复框）
    seen, alloc = set(), []
    for r in rows:
        if r["label"] in seen:
            continue
        seen.add(r["label"])
        alloc.append({"label": r["label"], "weight": r["weight"]})
    return {"name": name, "alloc": alloc, "png": png}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf", nargs="?", default=os.path.join(BASE, "tmp", "slr_mpf.pdf"))
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--asof", default=ASOF)
    ap.add_argument("--table", help="改用人工核对后的 JSON 表（OCR 只做数字旁证），格式 {funds:{名:[[label,w],…]}}")
    a = ap.parse_args()

    if a.table:
        return apply_table(a.table, a.write)

    d = pymupdf.open(a.pdf)
    head = d[0].get_text()
    m = re.search(r"截至\s*As at\s*(\d{2})/(\d{2})/(\d{4})", head)
    if not m:
        print("✗ 读不到封面日期，终止")
        return 2
    pdf_asof = "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    if pdf_asof != a.asof:
        print(f"✗ PDF 日期 {pdf_asof} ≠ 期望 {a.asof}，终止（防止把旧季写进新季）")
        return 2

    DATA = load_map()
    # 词表 = 上一季已人工核对的标签 ∪ 通用词表（长词优先，避免「債券」吃掉「美元債券」）
    vocab = set(VOCAB)
    for d0 in DATA.values():
        for lbl, _w in d0["alloc"]:
            vocab.add(lbl)
    vocab = sorted(vocab, key=len, reverse=True)
    parsed, bad = {}, []
    for i in range(d.page_count):
        r = parse_page(d[i], vocab)
        if not r:
            continue
        if r["name"] in parsed:
            continue
        tot = round(sum(x["weight"] for x in r["alloc"]), 1)
        r["sum"] = tot
        if len(r["alloc"]) < 2 or not (99.5 <= tot <= 100.5):
            bad.append((r["name"], len(r["alloc"]), tot))
            continue
        parsed[r["name"]] = r

    print(f"PDF asOf={pdf_asof} 页数={d.page_count} 解析成功={len(parsed)} 失败={len(bad)}")
    print(f"{'基金':34s} {'条':>2s} {'合计':>6s}  明细")
    for nm, r in parsed.items():
        det = " ".join(f"{x['label']}{x['weight']}" for x in r["alloc"])
        print(f"{nm:34s} {len(r['alloc']):2d} {r['sum']:6.1f}  {det}")
    for nm, n, tot in bad:
        print(f"[!] {nm} 条={n} 合计={tot} → 拒写")

    # 与库内旧值逐只比对
    obj = json.load(io.open(HOLD, encoding="utf-8"))
    funds = obj["funds"]
    print("\n=== 与库内比对 ===")
    changed = 0
    for nm, r in parsed.items():
        key = nm if nm in DATA else None
        if not key:
            print(f"[!] {nm} 在映射表中找不到，跳过")
            continue
        ids = DATA[key]["ids"]
        old = funds.get(ids[0], {}).get("alloc") or []
        oldmap = {x["label"]: x["weight"] for x in old}
        newmap = {x["label"]: x["weight"] for x in r["alloc"]}
        diffs = [f"{k}:{oldmap.get(k)}→{newmap[k]}" for k in newmap if oldmap.get(k) != newmap[k]]
        gone = [k for k in oldmap if k not in newmap]
        flag = "same" if not diffs and not gone else f"{len(diffs)}改/{len(gone)}删"
        if flag != "same":
            changed += 1
        print(f"{nm:30s} ids={ids} {flag} {('; '.join(diffs[:4]))}{' | 删:'+','.join(gone) if gone else ''}")
    print(f"\n有变化的基金：{changed} / {len(parsed)}")

    if not a.write:
        print("（未写盘，加 --write 落库）")
        return 0
    if bad:
        print("✗ 存在校验失败项，整批不写")
        return 2
    if changed == 0:
        print("库内已是同一批数据，无需写入")
        return 0

    for nm, r in parsed.items():
        if nm not in DATA:
            continue
        for fid in DATA[nm]["ids"]:
            if fid not in funds:
                print(f"[!] 缺 id {fid}")
                continue
            funds[fid]["alloc"] = r["alloc"]
            funds[fid]["allocSum"] = round(sum(x["weight"] for x in r["alloc"]), 1)
            funds[fid]["allocIncomplete"] = False
            funds[fid]["allocTitle"] = "投資組合分布"
            src = funds[fid].get("src") or SRC_OLD
            if "季報" not in src:
                funds[fid]["src"] = SRC_OLD
            funds[fid]["asOf"] = a.asof
    obj["updatedAt"] = int(time.time() * 1000)
    with io.open(HOLD, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"已写入 {HOLD}")
    return 0


def apply_table(path, write):
    """把人工核对过的表落库：只动 alloc/allocSum/allocIncomplete/allocTitle，不改 src/asOf。"""
    tab = json.load(io.open(path, encoding="utf-8"))
    asof = tab.get("asof")
    DATA = load_map()
    obj = json.load(io.open(HOLD, encoding="utf-8"))
    funds = obj["funds"]
    bad = []
    rows = []
    for nm, pairs in tab["funds"].items():
        tot = round(sum(w for _l, w in pairs), 1)
        if not (99.5 <= tot <= 100.5) or len(pairs) < 2:
            bad.append((nm, len(pairs), tot))
            continue
        if nm not in DATA:
            bad.append((nm + "（映射表无此基金）", len(pairs), tot))
            continue
        rows.append((nm, pairs, tot))
    print(f"表内基金 {len(tab['funds'])} 只，可用 {len(rows)} 只，异常 {len(bad)} 只")
    changed = 0
    for nm, pairs, tot in rows:
        ids = DATA[nm]["ids"]
        old = {x["label"]: x["weight"] for x in (funds.get(ids[0], {}).get("alloc") or [])}
        alloc = [{"label": l, "weight": w} for l, w in pairs]
        new = {a["label"]: a["weight"] for a in alloc}
        d1 = [(k, old.get(k), new[k]) for k in new if old.get(k) != new[k]]
        d2 = [k for k in old if k not in new]
        tag = "same" if not d1 and not d2 else f"{len(d1)}改/{len(d2)}删"
        if tag != "same":
            changed += 1
        print(f"{nm:32s} ids={ids} {tag} 合计={tot}")
        for k, o, n in d1[:6]:
            print(f"    {k}: {o} → {n}")
        if d2:
            print(f"    删: {','.join(d2)}")
        cur_asof = funds.get(ids[0], {}).get("asOf")
        if asof and cur_asof and cur_asof != asof:
            print(f"    [!] asOf={cur_asof} ≠ 表 asof={asof}，跳过该基金")
            continue
        if write:
            for fid in ids:
                if fid not in funds:
                    print(f"    [!] 缺 id {fid}")
                    continue
                funds[fid]["alloc"] = alloc
                funds[fid]["allocSum"] = tot
                funds[fid]["allocIncomplete"] = False
                funds[fid]["allocTitle"] = "投資組合分布"
    for nm, n, tot in bad:
        print(f"[!] {nm} 条={n} 合计={tot} → 拒写")
    print(f"\n有变化：{changed} / {len(rows)}")
    if not write:
        print("（未写盘，加 --write 落库）")
        return 0
    if bad:
        print("✗ 有异常项，整批不写")
        return 2
    obj["updatedAt"] = int(time.time() * 1000)
    with io.open(HOLD, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
    print(f"已写入 {HOLD}")
    return 0


VOCAB = [
    "現金及存款", "貨幣市場工具", "港元債券", "美元債券", "人民幣債券", "亞洲債券", "歐洲債券",
    "日本債券", "環球債券", "其他債券", "香港股票", "中國股票", "亞洲股票", "日本股票",
    "歐洲股票", "美國股票", "環球股票", "其他股票", "其他", "現金及其他", "現金或現金等值",
    "資訊科技", "金融", "健康護理", "通信服務", "工業", "原材料", "公用事業", "能源", "房地產",
    "消費", "主要消費品", "非必需消費品", "必需性消費", "非必需性消費", "南韓", "台灣",
    "香港／中國", "印度", "澳洲", "新加坡", "泰國", "馬來西亞", "國際貨幣（除美元及港元）債券",
    "亞洲（不包括香港及日本）股票", "貨幣市場工具（港元）", "貨幣市場工具（人民幣）",
    "債券（人民幣）", "債券（港元）", "現金及存款（人民幣）", "現金及存款（港元）",
]

if __name__ == "__main__":
    sys.exit(main())
