# -*- coding: utf-8 -*-
"""
非官方补值导入 —— 广州精研数据有限公司 · 香港强积金数据平台
================================================================
用途：官方源暂时取不到某段净值时（如新地 2026-10-02～11-09），
      允许导入第三方数据，并在页面明确标注「非官方补值」，待官方恢复后替换。

输入 CSV（UTF-8，含表头）：date,id,nav,src,note
  date   YYYY-MM-DD
  id     基金 id（与 funds.json 一致）
  nav    净值（4 位小数）
  src    来源说明（会显示在悬浮提示里），如「HKET 每日价格（第三方转载）」
  note   可选备注

规则：
  · 只填补 hist 中**缺失**的日期；默认不覆盖已有官方点（--replace 才覆盖）；
  · 每只基金写入 data/hist/<id>.json，并在 data/hist-provisional.json 登记；
  · 同时推进 funds.nav/navAsOf（仅当日期更新）。

用法：
  python tools/apply-provisional.py --csv tmp/backfill.csv
  python tools/apply-provisional.py --csv tmp/backfill.csv --replace   # 官方数据回来后覆盖
"""
import argparse
import csv
import json
import os
import shutil
from datetime import datetime

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
REG = os.path.join(DATA, "hist-provisional.json")


def load(p, default=None):
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", required=True)
    ap.add_argument("--replace", action="store_true", help="覆盖已有官方点（官方数据恢复后使用）")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    reg = load(REG, {"funds": {}})
    funds_doc = load(os.path.join(DATA, "funds.json"), {})
    by_id = {str(f["id"]): f for f in (funds_doc.get("funds") or [])}

    rows = []
    with open(args.csv, encoding="utf-8-sig") as fh:
        for r in csv.DictReader(fh):
            d = (r.get("date") or "").strip()
            fid = (r.get("id") or "").strip()
            try:
                nav = round(float(r.get("nav")), 4)
            except (TypeError, ValueError):
                continue
            if not d or not fid or nav <= 0:
                continue
            rows.append((fid, d, nav, (r.get("src") or "第三方").strip(), (r.get("note") or "").strip()))

    touched = {}
    for fid, d, nav, src, note in rows:
        hp = os.path.join(DATA, "hist", fid + ".json")
        hist = load(hp)
        if not hist or not hist.get("series"):
            print("  跳过 %s：无历史文件" % fid)
            continue
        m = {p[0]: i for i, p in enumerate(hist["series"])}
        if d in m and not args.replace:
            continue
        if d in m:
            hist["series"][m[d]][1] = nav
        else:
            hist["series"].append([d, nav])
        hist["series"].sort(key=lambda x: x[0])
        hist["asOf"] = hist["series"][-1][0]
        hist["last"] = hist["series"][-1][1]
        hist["points"] = len(hist["series"])
        if not args.dry:
            with open(hp, "w", encoding="utf-8", newline="\n") as fh:
                json.dump(hist, fh, ensure_ascii=False)
        touched.setdefault(fid, []).append((d, nav, src, note))
        f = by_id.get(fid)
        if f and d >= (f.get("navAsOf") or ""):
            f["nav"] = nav
            f["navAsOf"] = d
            f["navSourceNote"] = "含非官方补值（%s）" % src

    for fid, pts in touched.items():
        ent = reg["funds"].setdefault(fid, {"src": pts[0][2], "note": pts[0][3], "appliedAt": None, "points": []})
        ent["src"] = pts[0][2]
        if pts[0][3]:
            ent["note"] = pts[0][3]
        ent["appliedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        have = {p[0] for p in ent["points"]}
        for d, nav, _s, _n in pts:
            if d not in have:
                ent["points"].append([d, nav])
        ent["points"].sort(key=lambda x: x[0])
        print("  %s：补 %d 点（%s）" % (fid, len(pts), pts[0][2]))

    if not args.dry:
        reg["updatedAt"] = datetime.now().astimezone().isoformat(timespec="seconds")
        with open(REG, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(reg, fh, ensure_ascii=False, indent=1)
        with open(os.path.join(DATA, "funds.json"), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(funds_doc, fh, ensure_ascii=False)
    print("完成：%d 只、%d 点%s" % (len(touched), sum(len(v) for v in touched.values()),
                                   "（dry-run 未写盘）" if args.dry else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
