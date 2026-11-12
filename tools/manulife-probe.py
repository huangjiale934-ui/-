# -*- coding: utf-8 -*-
"""
宏利官网净值「发布时点」探测器
==============================
用途：宏利 fundhistory API 只返回 asOfDate，没有任何发布时间字段。
     本脚本按固定间隔反复采样 maxDate，用「第一次看到新日期的时间」反推发布时点区间。
     采样间隔即为精度上限（默认 5 分钟 → 误差 <= 5 分钟）。

输出：
  data/probe/manulife-release.jsonl   逐次采样流水（追加写）
  data/probe/manulife-summary.json    按日汇总的发布窗口统计

用法：
  python tools/manulife-probe.py --once                     # 采一次（连通性自测）
  python tools/manulife-probe.py --minutes 330 --interval 5  # 连续采 5.5 小时
"""
import argparse
import json
import os
import signal
import sys
import time
from datetime import datetime, timedelta, timezone

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = os.path.join(BASE, "data", "probe")
JSONL = os.path.join(OUT_DIR, "manulife-release.jsonl")
SUMMARY = os.path.join(OUT_DIR, "manulife-summary.json")

API = "https://www.manulife.com.hk/bin/funds/fundhistory"
HEADERS = {
    "Accept": "application/json",
    "Referer": "https://www.manulife.com.hk/zh-HK/personal/funds/manulife-mpf",
    "Origin": "https://www.manulife.com.hk",
}
HKT = timezone(timedelta(hours=8))

# 两条产品线各取一只代表基金：環球精選（SHK*）与退休精選/安聯系（RB*）
# 实测两者发布节奏不同（11-10：SHK 已到 11-06，RB 仍是 11-05），必须分开采样。
TARGETS = [
    ("SHK122", "宏利環球精選 · 宏利MPF穩健基金"),
    ("RBIA", "宏利退休精選 · 安聯亞洲基金 A"),
]

_stop = {"flag": False}


def _on_term(signum, frame):  # noqa: ARG001
    _stop["flag"] = True


def fetch(code, retries=2):
    """采一次；返回 {status, maxDate, ms}，异常不抛出。"""
    last = None
    for attempt in range(retries):
        t0 = time.time()
        try:
            r = cffi.get(
                API,
                params={"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"},
                impersonate="chrome",
                headers=HEADERS,
                timeout=30,
            )
            ms = int((time.time() - t0) * 1000)
            if r.status_code != 200:
                last = {"status": r.status_code, "ms": ms, "error": "HTTP %s" % r.status_code}
            else:
                j = r.json()
                ph = j.get("priceHistory") or []
                return {
                    "status": 200,
                    "ms": ms,
                    "maxDate": (j.get("maxDate") or "").strip(),
                    "points": len(ph),
                }
        except Exception as e:  # noqa: BLE001
            last = {"status": 0, "ms": int((time.time() - t0) * 1000), "error": str(e)[:120]}
        if attempt < retries - 1:
            time.sleep(1.2)
    return last or {"status": 0, "ms": 0, "error": "unknown"}


def append_records(rows):
    """追加采样流水。
    2026-11-13（复核发现）：原来只写一个 manulife-release.jsonl，云端每次 checkout 到的
    基线可能比上一次提交旧（并发 rebase），追加后反而把已有记录「截短」——实测文件只剩
    30 小时、早期记录全丢。现在改成「按天分文件 + 写前并集合并」，最坏只影响当天：
      · 每天一个 manulife-release-YYYY-MM-DD.jsonl（可长期留存、互不影响）
      · 同日文件按 (时间+代码) 去重后取并集再写回，重复跑不会丢数据
    """
    os.makedirs(OUT_DIR, exist_ok=True)
    by_day = {}
    for row in rows:
        d = str(row.get("t") or "")[:10] or "unknown"
        by_day.setdefault(d, []).append(row)
    for d, rs in by_day.items():
        path = os.path.join(OUT_DIR, "manulife-release-%s.jsonl" % d) if d != "unknown" else JSONL
        seen = set()
        merged = []
        if os.path.exists(path):
            try:
                with open(path, encoding="utf-8") as fh:
                    for line in fh:
                        line = line.strip()
                        if not line:
                            continue
                        try:
                            old = json.loads(line)
                        except ValueError:
                            continue
                        k = (old.get("t"), old.get("code"), old.get("maxDate"))
                        if k in seen:
                            continue
                        seen.add(k)
                        merged.append(old)
            except OSError:
                pass
        for row in rs:
            k = (row.get("t"), row.get("code"), row.get("maxDate"))
            if k in seen:
                continue
            seen.add(k)
            merged.append(row)
        merged.sort(key=lambda x: (str(x.get("t")), str(x.get("code"))))
        with open(path, "w", encoding="utf-8") as fh:
            for row in merged:
                fh.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _all_record_paths():
    import glob
    return sorted(glob.glob(os.path.join(OUT_DIR, "manulife-release-*.jsonl")))


def load_records():
    """读全部按天文件（新格式）+ 旧的单文件（兼容）。"""
    rows = []
    paths = _all_record_paths()
    if os.path.exists(JSONL):
        paths = [JSONL] + paths
    for p in paths:
        with open(p, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    continue
    # 同一个采样点可能同时存在于旧单文件与按天文件里，按 (时间,代码,净值日) 去重
    uniq = {}
    for r in rows:
        uniq[(r.get("t"), r.get("code"), r.get("maxDate"))] = r
    rows = list(uniq.values())
    rows.sort(key=lambda x: (str(x.get("t")), str(x.get("code"))))
    return rows


def _fmt_hkt(ts):
    try:
        dt = datetime.fromisoformat(ts)
        return dt.astimezone(HKT).strftime("%m-%d %H:%M:%S")
    except Exception:  # noqa: BLE001
        return ts


def build_summary(rows):
    """把逐次采样折成「每个净值日期第一次被看到」的窗口。"""
    by_code = {}
    for row in rows:
        by_code.setdefault(row.get("code", "?"), []).append(row)

    funds = {}
    for code, label in TARGETS:
        seq = sorted(by_code.get(code, []), key=lambda x: x.get("t", ""))
        seen = None
        transitions = []
        ok = [r for r in seq if r.get("status") == 200 and r.get("maxDate")]
        for idx, rec in enumerate(ok):
            md = rec["maxDate"]
            if seen is None:
                if idx > 0:
                    # 窗口开始时已经是这个日期 —— 说明发布发生在本次探测启动之前
                    transitions.append({
                        "date": md,
                        "detectedAt": _fmt_hkt(rec["t"]),
                        "windowMinutes": None,
                        "note": "探测开始前已发布，窗口未知",
                    })
                seen = md
                continue
            if md > seen:
                prev = ok[idx - 1] if idx > 0 else None
                minutes = None
                if prev:
                    try:
                        minutes = round(
                            (datetime.fromisoformat(rec["t"]) - datetime.fromisoformat(prev["t"]))
                            .total_seconds() / 60, 1)
                    except Exception:  # noqa: BLE001
                        minutes = None
                transitions.append({
                    "date": md,
                    "prevSample": _fmt_hkt(prev["t"]) if prev else None,
                    "detectedAt": _fmt_hkt(rec["t"]),
                    "windowMinutes": minutes,
                })
                seen = md

        det = [t for t in transitions if t.get("windowMinutes") is not None]
        stats = {"days": len(det)}
        if det:
            hhmm = [t["detectedAt"][-8:-3] for t in det]  # MM-DD HH:MM:SS → HH:MM
            wins = sorted(t["windowMinutes"] for t in det)
            stats.update({
                "medianDetectedAt": hhmm[len(hhmm) // 2],
                "earliest": min(hhmm),
                "latest": max(hhmm),
                "medianWindowMinutes": wins[len(wins) // 2],
            })
        funds[code] = {"label": label, "transitions": transitions, "stats": stats}

    return {
        "generatedAt": datetime.now(HKT).isoformat(timespec="seconds"),
        "samples": len(rows),
        "funds": funds,
    }


def write_summary(rows):
    summary = build_summary(rows)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(SUMMARY, "w", encoding="utf-8") as fh:
        json.dump(summary, fh, ensure_ascii=False, indent=1)
    return summary


def print_summary(summary):
    print("\n=== 宏利净值发布窗口汇总（累计 %d 条采样记录）===" % summary["samples"])
    for code, info in summary["funds"].items():
        print("\n%s  %s" % (code, info["label"]))
        if not info["transitions"]:
            print("  暂无日期切换记录")
            continue
        for t in info["transitions"]:
            if t.get("windowMinutes") is None:
                print("  %s  首次采样已是新日期（%s）" % (t["date"], t.get("note", "")))
            else:
                print("  %s  上次旧数据 %s → 首次新数据 %s（窗口 %.1f 分钟）" % (
                    t["date"], t.get("prevSample"), t.get("detectedAt"), t["windowMinutes"]))
        st = info["stats"]
        if st.get("days"):
            print("  统计：%d 天，检出中位 %s，最早 %s，最晚 %s" % (
                st["days"], st.get("medianDetectedAt"), st.get("earliest"), st.get("latest")))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--minutes", type=float, default=330, help="本次连续采样时长（分钟）")
    ap.add_argument("--interval", type=float, default=5, help="采样间隔（分钟）")
    ap.add_argument("--once", action="store_true", help="只采一次")
    args = ap.parse_args()

    signal.signal(signal.SIGTERM, _on_term)
    signal.signal(signal.SIGINT, _on_term)

    os.makedirs(OUT_DIR, exist_ok=True)
    deadline = time.time() + max(0, args.minutes) * 60
    rounds = 0
    failures = 0

    # 启动时一次性读入历史，后续只维护内存里的「上次看到的日期」
    last_seen = {}
    for rec in load_records():
        if rec.get("status") == 200 and rec.get("maxDate"):
            last_seen[rec["code"]] = rec["maxDate"]

    while not _stop["flag"]:
        rounds += 1
        now = datetime.now(HKT)
        rows = []
        parts = []
        for code, label in TARGETS:
            res = fetch(code)
            row = {"t": now.isoformat(timespec="seconds"), "code": code, "label": label}
            row.update(res)
            rows.append(row)
            if res.get("status") == 200:
                parts.append("%s %s (%.1fs)" % (code, res.get("maxDate", "?"), res.get("ms", 0) / 1000))
                md = res.get("maxDate")
                prev = last_seen.get(code)
                if md and prev and md > prev:
                    print("  *** %s 出现新日期 %s（上次采样仍是 %s）" % (code, md, prev), flush=True)
                if md and (not prev or md > prev):
                    last_seen[code] = md
            else:
                failures += 1
                parts.append("%s 失败 %s" % (code, res.get("error") or res.get("status")))
        append_records(rows)
        print("[%s] #%d  %s" % (now.strftime("%H:%M:%S"), rounds, " | ".join(parts)), flush=True)

        if args.once or _stop["flag"] or time.time() + args.interval * 60 > deadline:
            break
        # 分段睡，便于收到 SIGTERM 时尽快收尾
        target = time.time() + args.interval * 60
        while time.time() < target and not _stop["flag"]:
            time.sleep(min(5, max(0.2, target - time.time())))

    summary = write_summary(load_records())
    print_summary(summary)
    print("\n采样轮次 %d，失败 %d 次；明细 %s" % (rounds, failures, os.path.relpath(JSONL, BASE)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
