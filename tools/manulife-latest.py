# -*- coding: utf-8 -*-
"""
宏利系「最新一点」补齐 —— 广州精研数据有限公司 · 香港强积金数据平台
=====================================================================
背景（2026-11-16，用户反馈）：
  · 白天轻量更新只读宏利「列表页」，而列表页对个别基金（1525/1528）曾停在 11-10，
    同一计划另外 37 只已是 11-11；
  · 每天 03:58 的 nav-recheck 依赖 funds[].code，而这两只 code 为空 → 被静默跳过；
  · 实测 fundhistory API 当时已有 11-11（12.325 / 18.9581），说明是抓取链路漏了。

做法：
  用 data/manulife-ids.json（名称→官网代码）逐只查 fundhistory，
  只有当官网末点**晚于**本地 hist 末点时才追加（绝不覆盖已有官方点）。
  同时把 funds 的 nav / navAsOf 推进到新末点。

用法：
  python tools/manulife-latest.py            # 全量 67 只
  python tools/manulife-latest.py --dry      # 只报告差异，不写盘
  python tools/manulife-latest.py --id 1525  # 只查某几只
输出：
  data/hist/<id>.json 追加新点；data/funds.json 更新 nav/navAsOf
"""
import argparse
import json
import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(BASE, "data")
API = "https://www.manulife.com.hk/bin/funds/fundhistory"
HEADERS = {
    "Accept": "application/json",
    "Referer": "https://www.manulife.com.hk/zh-HK/personal/funds/manulife-mpf",
    "Origin": "https://www.manulife.com.hk",
}


def load_json(p, default=None):
    try:
        with open(p, encoding="utf-8") as fh:
            return json.load(fh)
    except Exception:
        return default


def fetch(code, tries=3):
    """多次请求：宏利多节点最终一致，单次命中旧节点很常见（2026-11-14 实测 5 分钟级抖动）。"""
    last_err = None
    best = None
    for i in range(tries):
        try:
            r = cffi.get(API, params={"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"},
                         headers=HEADERS, impersonate="chrome", timeout=30)
            if r.status_code != 200:
                last_err = "HTTP %s" % r.status_code
                time.sleep(1.5 * (i + 1))
                continue
            rows = []
            for it in (r.json().get("priceHistory") or []):
                d = (it.get("asOfDate") or "").strip()
                try:
                    v = round(float(it.get("price")), 4)
                except (TypeError, ValueError):
                    continue
                if d and v > 0:
                    rows.append((d, v))
            rows.sort()
            if rows and (best is None or rows[-1][0] > best[-1][0]):
                best = rows
            if best and best[-1][0] >= time.strftime("%Y-%m-%d", time.localtime(time.time() - 86400)):
                break
            time.sleep(1.5 * (i + 1))
        except Exception as e:  # noqa: BLE001
            last_err = str(e)[:80]
            time.sleep(1.5 * (i + 1))
    return best, last_err


def main():
    # 2026-11-22（运维事故）：本步曾在 5.55 卡死 27 分钟（curl_cffi 个别请求不返回），
    # 导致整条 nightly 停在半路、站点一直显示「更新中」。加看门狗：420s 未完成就跳过本轮。
    import threading
    def _wd(sec):
        time.sleep(sec)
        print("!! 宏利最新点补齐超时（%ds），跳过本轮，下一班重试" % sec, flush=True)
        os._exit(0)
    threading.Thread(target=_wd, args=(420,), daemon=True).start()

    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--id", action="append", default=[])
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()

    funds_doc = load_json(os.path.join(DATA, "funds.json"), {})
    funds = funds_doc.get("funds") or []
    ids = load_json(os.path.join(DATA, "manulife-ids.json"), {})
    code_by_name = {}
    code_by_name.update(ids.get("gs") or {})
    code_by_name.update(ids.get("rc") or {})

    tasks = []
    for f in funds:
        if args.id and str(f.get("id")) not in args.id:
            continue
        code = code_by_name.get(f.get("fund"))
        if not code:
            continue
        tasks.append((f, code))

    print("待查 %d 只（宏利系）" % len(tasks))
    results = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futs = {ex.submit(fetch, code): (f, code) for f, code in tasks}
        for done, fut in enumerate(as_completed(futs), 1):
            f, code = futs[fut]
            rows, err = fut.result()
            results[str(f.get("id"))] = (f, code, rows, err)
            if done % 20 == 0:
                print("  ... %d/%d" % (done, len(tasks)))

    added_points = 0
    updated_funds = 0
    for fid, (f, code, rows, err) in results.items():
        if not rows:
            if err:
                print("  !! %s %s 取不到：%s" % (fid, code, err))
            continue
        hp = os.path.join(DATA, "hist", fid + ".json")
        hist = load_json(hp)
        if not hist or not hist.get("series"):
            continue
        last = hist["series"][-1][0]
        new = [p for p in rows if p[0] > last]
        if not new:
            continue
        print("  + %s %-6s %s 追加 %d 点：%s → %s" %
              (fid, code, (f.get("fund") or "")[:22], len(new), last, rows[-1][0]))
        added_points += len(new)
        if args.dry:
            continue
        hist["series"].extend([list(p) for p in new])
        hist["series"].sort(key=lambda r: r[0])
        hist["asOf"] = hist["series"][-1][0]
        hist["last"] = hist["series"][-1][1]
        hist["points"] = len(hist["series"])
        with open(hp, "w", encoding="utf-8", newline="\n") as fh:
            json.dump(hist, fh, ensure_ascii=False)
        # 推进基金表的净值（只前进，不倒退）
        if rows[-1][0] >= (f.get("navAsOf") or ""):
            f["nav"] = rows[-1][1]
            f["navAsOf"] = rows[-1][0]
            updated_funds += 1

    if not args.dry and added_points:
        with open(os.path.join(DATA, "funds.json"), "w", encoding="utf-8", newline="\n") as fh:
            json.dump(funds_doc, fh, ensure_ascii=False)
    print("完成：追加 %d 点，更新基金表 %d 只%s" % (added_points, updated_funds, "（dry-run 未写盘）" if args.dry else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
