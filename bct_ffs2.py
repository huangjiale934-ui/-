# -*- coding: utf-8 -*-
"""BCT 便覽通用解析（bct_ffs2.py）—— 按中文基金名精确匹配，兼容两种排版
====================================================================
输入的 PDF（官方固定/当月档）：
  IS_Fact_Sheet.pdf     BCT（強積金）行業計劃   12 只，「Top 10 Portfolio Holdings … 9.4%」
  MTS_Fact_Sheet.pdf    積金之選（含儲蓄易 2045/2050）
  IV_Fact_Sheet.pdf     BCT強積金策略計劃（景順系 13 只，版面为「Top Ten Holdings (%)」坐标式）
  Smart/Simple/S800_FFS_*.pdf
用法：python bct_ffs2.py tmp/IS_Fact_Sheet.pdf [tmp/MTS_Fact_Sheet.pdf ...]
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

PLANS = [
    ("行業計劃", ["行業計劃", "Industry Choice"]),
    ("積金之選", ["積金之選", "Pro Choice"]),
    ("策略計劃", ["策略計劃", "Strategic MPF"]),
    ("明智之選", ["明智之選", "Smart Choice"]),
    ("易富之選", ["易富之選", "Simple Choice"]),
    ("800系列", ["800", "Series 800"]),
]


def norm(s):
    s = (s or "").replace("（", "(").replace("）", ")")
    s = s.replace("\u3000", "").replace(" ", "")
    return s


def asof_of(t):
    m = re.search(r"截至\s*(\d{2})/(\d{2})/(\d{4})", t)
    if m:
        return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    m = re.search(r"As at\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})", t)
    if m:
        MON = dict(jan=1, feb=2, mar=3, apr=4, may=5, jun=6, jul=7, aug=8, sep=9, oct=10, nov=11, dec=12)
        mo = MON.get(m.group(2)[:3].lower())
        if mo:
            return "%s-%02d-%02d" % (m.group(3), mo, int(m.group(1)))
    m = re.search(r"截至\s*(\d{4})\s*(\d{1,2})\s*(\d{1,2})\s*日", t)
    if m:
        return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))
    return None


def top10_lines(t):
    """版式 A：行尾带 %（名称内也可能含 % —— 取最后一个 % 数字为权重）"""
    for hdr in ("Top 10 Portfolio Holdings", "Top 10 Holdings", "十大主要投資項目",
                "Top Ten Holdings", "十大投資"):
        i = t.find(hdr)
        if i >= 0:
            break
    else:
        return []
    seg = t[i:i + 1200]
    out = []
    for raw in seg.split("\n")[1:]:
        l = raw.strip()
        if not l:
            continue
        if l.startswith("Market Commentary") or l.startswith("市場評論") or l.startswith("Remarks"):
            break
        if re.match(r"^[\d.\s]+$", l):          # 右侧 NAV 轴刻度
            continue
        pcts = list(re.finditer(r"(\d+\.\d+)%", l))
        if pcts:                                 # 版式 A：行尾带 %
            last = pcts[-1]
            nm = l[:last.start()].strip(" .·-")
            w = float(last.group(1))
        else:                                    # 版式 C：名称 + 裸数字（信安 800 系列「十大投資」）
            m = re.match(r"^(.+?)\s+(\d{1,2}(?:\.\d+)?)$", l)
            if not m:
                continue
            nm, w = m.group(1).strip(" .·-"), float(m.group(2))
        if not nm or len(nm) < 2 or len(nm) > 90:
            continue
        if nm.lower() in ("unit nav", "unit nav 單位資產淨值"):
            continue
        if w <= 0 or w > 100:
            continue
        out.append({"name": nm[:70], "weight": w})
        if len(out) >= 10:
            break
    return out


def top10_coord(page):
    """版式 B：坐标式（Top Ten Holdings (%)）
    —— 权重列右对齐 x≈560；名称在中列（x 402~545，居中排版，长名会折行）；
       中文副名常落在权重行下方约 5pt；左栏资产分布 x<400 直接排除。
    归属规则：每个词归到**最近的权重行**（|dy|≤10），避免折行/副名错配。"""
    ws = page.extract_words(x_tolerance=2, y_tolerance=2)
    hdr = [w for w in ws if w["text"] == "Holdings" and w["top"] < page.height * 0.7]
    if not hdr:
        return []
    y0 = min(w["top"] for w in hdr)
    weights = []
    for w in ws:
        if w["top"] <= y0 or w["top"] > page.height * 0.78:
            continue
        if w["x0"] > 545 and re.match(r"^\d{1,2}\.\d$", w["text"]):
            weights.append((w["top"], float(w["text"])))
    if not weights:
        return []
    weights.sort()
    bag = {i: [] for i in range(len(weights))}
    for w in ws:
        if w["top"] <= y0 or w["top"] > page.height * 0.78:
            continue
        if not (402 <= w["x0"] < 545):
            continue
        if "持有量" in w["text"] or w["text"] in ("(%)", "Top", "Ten", "Holdings"):
            continue
        if "\ufffd" in w["text"]:            # 字体子集导致的中文乱码，丢弃
            continue
        best, bd = -1, 99
        for i, (wy, _) in enumerate(weights):
            d = abs(w["top"] - wy)
            if d < bd:
                bd, best = d, i
        if bd <= 10:
            bag[best].append((w["x0"], w["text"], w["top"]))
    out = []
    for i, (wy, wv) in enumerate(weights):
        nm = " ".join(t for _, t, _y in sorted(bag[i], key=lambda z: (round(z[2], 0), z[0]))).strip()
        if len(nm) and wv > 0:
            out.append({"name": nm[:70], "weight": wv})
        if len(out) >= 10:
            break
    return out


def top10_columns(page, hdr="十大"):
    """版式 D（信安 800 系列「十大投資 Top Ten Holdings (%)」）：
    左栏 = 名称（x≈27 起）+ 权重右对齐成一列（x≈269），右栏为资产分布图表——
    因此**必须按列解析**，行解析会把右栏数字当成权重。
    权重列位置自动探测：取下方区域出现次数最多的「两位小数」列。"""
    ws = page.extract_words(x_tolerance=2, y_tolerance=2)
    hd = [w for w in ws if hdr in w["text"]]
    if not hd:
        return []
    y0 = hd[0]["top"]
    # 右半页是「資產分佈」图表（另有自己的百分比列）→ 权重列只可能在左半页
    half = page.width * 0.5
    cand = [w for w in ws if y0 < w["top"] < y0 + 200 and w["x0"] < half
            and re.match(r"^\d{1,2}\.\d{1,2}$", w["text"])]
    if not cand:
        return []
    cols = {}
    for w in cand:
        cols.setdefault(round(w["x0"] / 4) * 4, []).append(w)
    wx = max(cols.items(), key=lambda kv: len(kv[1]))[0]
    picks = [w for w in cand if round(w["x0"] / 4) * 4 == wx]
    if len(picks) < 4:
        return []
    out = []
    for w in sorted(picks, key=lambda z: z["top"]):
        nm = " ".join(t["text"] for t in sorted(ws, key=lambda z: z["x0"])
                      if t["x0"] < wx - 8 and abs(t["top"] - w["top"]) <= 6.5)
        nm = nm.strip()
        wv = float(w["text"])
        if nm and 0 < wv <= 100:
            out.append({"name": nm[:70], "weight": wv})
        if len(out) >= 10:
            break
    return out


def alloc_of(t):
    """資產分佈：便覽用「A:現金及其他 4.4%」字母鍵分行（左右兩欄，行不一定在行首）。
    取每項的中文標籤（去掉尾註數字），合計通常 ≈100。"""
    out = []
    for m in re.finditer(r"(?:^|\s)([A-Z]):\s*([^\n]+?)\s+(\d+\.\d+)%", t):
        body = m.group(2)
        cn = re.findall(r"[\u4e00-\u9fff][\u4e00-\u9fff/及、 ]*", body)
        lbl = (cn[-1] if cn else "").strip()
        if not lbl:
            continue
        if any(x["label"] == lbl for x in out):
            continue
        out.append({"label": lbl, "weight": float(m.group(3))})
    return out


def run_file(path, hld, FN, dry=False, quiet=False):
    """处理单份 PDF，返回写入条数（只补空缺 / dry 时仅打印）"""
    tot = 0
    pdf = pdfplumber.open(path)
    first = " ".join((pdf.pages[i].extract_text() or "") for i in range(min(3, len(pdf.pages))))
    plan = next((p for p, kws in PLANS if any(norm(k) in norm(first) for k in kws)), None)
    pool = [x for x in FN if plan and plan in (x.get("scheme") or "")]
    if not quiet:
        print("\n== %s → 计划 %s（%d 只）" % (os.path.basename(path), plan, len(pool)))
    if not pool:
        if not quiet:
            print("  !! 未识别计划")
        pdf.close()
        return 0
    # 按 fundBase 长度降序，保证最长匹配优先
    pool = sorted(pool, key=lambda x: -len(norm(x.get("fundBase"))))
    used = set()
    for pi in range(len(pdf.pages)):
        pg = pdf.pages[pi]
        t = pg.extract_text() or ""
        if ("Top 10 Portfolio Holdings" not in t and "Top Ten Holdings" not in t
                and "Top 10 Holdings" not in t and "十大" not in t):
            continue
        nt = norm(t)
        cand = [x for x in pool if norm(x.get("fundBase")) in nt]
        if not cand:
            continue
        x = cand[0]
        if "十大投資" in t or "十大主要投資" in t:
            top = top10_columns(pg)         # 信安系（800/明智/易富）：左右双栏，必须按列取
        elif "Top Ten Holdings" in t and "Top 10 Portfolio" not in t:
            top = top10_coord(pg)          # 坐标式（景順：文本层左右栏交错，不可用行解析）
        else:
            top = top10_lines(t)           # BCT 行業/積金之選：行尾带 %
            if len(top) < 3:
                top = top10_coord(pg)
        if len(top) < 3:
            continue
        asof = asof_of(t) or "2026-06-30"
        old = hld["funds"].get(str(x["id"]))
        alloc = alloc_of(t)
        if dry:
            used.add(x["id"])
            print("  · p%-2d #%-5s %-20s %s n=%d alloc=%d %s" % (
                pi + 1, x["id"], x.get("fundBase")[:20], asof, len(top), len(alloc),
                " | ".join("%s %.1f" % (v["name"][:16], v["weight"]) for v in top[:2])), flush=True)
            continue
        if old and len(old.get("top10") or []) > len(top):
            used.add(x["id"])              # 已有更全的持仓 → 只补资产分布
            if alloc and not old.get("alloc"):
                old["alloc"] = alloc
                old["allocLabel"] = "資產分佈"
                tot += 1
                if not quiet:
                    print("  ✔ p%d #%s %-22s 仅补资产分布 %d 项" % (
                        pi + 1, x["id"], x.get("fundBase")[:22], len(alloc)), flush=True)
            continue
        hld["funds"][str(x["id"])] = {
            "asOf": asof,
            "src": "BCT 官方基金便覽 PDF（%s）" % os.path.basename(path),
            "top10": top,
            "alloc": alloc or (old or {}).get("alloc") or [],
            "allocLabel": "資產分佈" if (alloc or (old or {}).get("alloc")) else None,
        }
        # 2026-10-26：写盘前质量闸门（旧的好、新的坏 → 不覆盖）。
        # 当天 BCT 解析退化，19 只 top10 名称被写成空、20 只分布塌缩，靠人工回滚才发现。
        try:
            import sys as _sys, os as _os
            _sys.path.insert(0, _os.path.join(_os.path.dirname(_os.path.abspath(__file__)), 'tools'))
            from holdings_filter import errors as _errs, is_degraded as _degraded
            _cand = hld["funds"][str(x["id"])]
            if _degraded(old, _cand):
                print("  ⚠ #%s %s 解析结果不合规（%s），保留旧数据" %
                      (x["id"], x.get("fundBase"), "/".join(_errs(_cand))), flush=True)
                hld["funds"][str(x["id"])] = old
                continue
        except Exception as _e:
            print("  ! 质量闸门异常（已放行）：%s" % _e, flush=True)
        used.add(x["id"])
        tot += 1
        if not quiet:
            print("  ✔ p%d #%s %-22s %s top10=%d 首行=%s %.1f" % (
                pi + 1, x["id"], x.get("fundBase")[:22], asof, len(top),
                top[0]["name"][:26], top[0]["weight"]), flush=True)
    # 同基金多单位类别（A/H）→ 共用同一投资组合（仅当同胞数据更全时覆盖）
    for x in pool:
        if x["id"] in used:
            continue
        sib = [y for y in pool if y["id"] in used
               and norm(y.get("fundBase")) == norm(x.get("fundBase"))]
        if not sib:
            continue
        s = hld["funds"].get(str(sib[0]["id"]))
        if not s:
            continue
        cur = hld["funds"].get(str(x["id"])) or {}
        if len(cur.get("top10") or []) >= len(s.get("top10") or []):
            continue
        hld["funds"][str(x["id"])] = json.loads(json.dumps(s))
        hld["funds"][str(x["id"])]["src"] = s["src"] + "（%s 类单位共用同一投资组合）" % sib[0].get("unit", "")
        tot += 1
        if not quiet:
            print("  ✔ 同组合复制 #%s %s（%s 类）" % (x["id"], x.get("fundBase"), x.get("unit")), flush=True)
    pdf.close()
    return tot


def load():
    hld = json.load(open(HOLD, encoding="utf-8"))
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    return hld, FN


def save(hld):
    hld["count"] = len(hld["funds"])
    hld["updatedAt"] = int(time.time() * 1000)
    srcs = set()
    for v in hld["funds"].values():
        if v.get("src"):
            srcs.add(v["src"].split("（")[0])
    hld["source"] = " + ".join(sorted(srcs))
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))


def main():
    argv = [a for a in sys.argv[1:] if a != "--dry"]
    dry = "--dry" in sys.argv
    hld, FN = load()
    tot = 0
    for path in argv:
        tot += run_file(path, hld, FN, dry=dry)
    if not dry:
        save(hld)
    print("\n写入 %d ；holdings 共 %d" % (tot, len(hld["funds"])))


if __name__ == "__main__":
    main()
