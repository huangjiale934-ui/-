# -*- coding: utf-8 -*-
"""
宏利系历史净值回填 —— 广州精研数据有限公司 · 香港强积金数据平台
==============================================================
数据源：宏利官网 fundhistory API（Akamai 前置，须用 curl_cffi 伪装 Chrome 指纹）
覆盖：
  · 宏利環球精選（強積金）計劃   28 只（SHKxxx 码）
  · 宏利退休精選（強積金）計劃   39 只（安聯系基金 × A/B/T 单位类别，代码如 RBBA）
输出：
  data/hist/<基金id>.json    每只一个文件（全量日序列，供走势图按需加载）
  data/hist-index.json      索引（可用性 / 起止日 / 点数，供列表与自算指标用）
用法：
  python fetch-manulife-hist.py            # 全量（约 2-4 分钟）
  python fetch-manulife-hist.py --limit 3  # 试跑前 3 只
"""
import json
import os
import re
import sys
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")

API = "https://www.manulife.com.hk/bin/funds/fundhistory"
HEADERS = {
    "Accept": "application/json",
    "Referer": "https://www.manulife.com.hk/zh-HK/personal/funds/manulife-mpf",
    "Origin": "https://www.manulife.com.hk",
}
SRC_LABEL = "宏利官网（www.manulife.com.hk）"


def fetch_history(code, retries=3):
    """拉取单只基金全量 priceHistory；返回 [(date, price), ...] 或 None"""
    params = {"id": code, "productLine": "mpf", "overrideLocale": "zh_Hant_HK"}
    last_err = ""
    for attempt in range(retries):
        try:
            r = cffi.get(API, params=params, impersonate="chrome",
                         headers=HEADERS, timeout=45)
            if r.status_code == 200:
                ph = r.json().get("priceHistory", [])
                out = []
                for it in ph:
                    d = (it.get("asOfDate") or "").strip()
                    p = it.get("price")
                    try:
                        p = float(p)
                    except (TypeError, ValueError):
                        continue
                    if d and p > 0:
                        out.append([d, round(p, 6)])
                return out
            last_err = "HTTP %s" % r.status_code
        except Exception as e:  # noqa: BLE001
            last_err = str(e)[:80]
        if attempt < retries - 1:
            time.sleep(1.5 + attempt)
    print("      [!] %s 失败：%s" % (code, last_err))
    return None


def main():
    limit = 0
    if "--limit" in sys.argv:
        limit = int(sys.argv[sys.argv.index("--limit") + 1])

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    idmap = json.load(open(os.path.join(DATA, "manulife-ids.json"), encoding="utf-8"))
    gs, rc = idmap.get("gs", {}), idmap.get("rc", {})

    # 组装任务：每只基金 →（我方id, 官网code, 计划, 名称, 单位）
    tasks = []
    for x in funds:
        code = None
        if x.get("trustee") == "宏利" and x["fund"] in gs:
            code = gs[x["fund"]]
        elif x.get("scheme") == "宏利退休精選（強積金）計劃" and x["fund"] in rc:
            code = rc[x["fund"]]
        if code:
            tasks.append((x["id"], code, x.get("scheme", ""), x["fund"], x.get("unit", "")))
    if limit:
        tasks = tasks[:limit]
    print("待回填 %d 只（宏利系）" % len(tasks))

    os.makedirs(HIST_DIR, exist_ok=True)
    index_path = os.path.join(DATA, "hist-index.json")
    index = {}
    if os.path.exists(index_path):
        try:
            index = json.load(open(index_path, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            index = {}

    # 2026-10-29：改为「先全部取回落内存 → 按批次末点找出滞后只 → 二次重试 → 再写盘」。
    # 原先是边取边写，个别单位类别（宏利退休精選的 A/B/T 三类）在云端偶发取到滞后一天
    # 的截断序列，写完就固化了（10-28：9 只停在 10-23，本机同源已到 10-26）。
    results = {}
    ok = fail = 0
    for i, (fid, code, scheme, name, unit) in enumerate(tasks, 1):
        series = fetch_history(code)
        if not series or len(series) < 30:
            fail += 1
            print("  %2d/%d  %s %s  [无数据/过短，跳过]" % (i, len(tasks), code, name))
            continue
        results[str(fid)] = (code, scheme, name, unit, series)
        print("  %2d/%d  %s %s   %s → %s (%d 点)" %
              (i, len(tasks), code.ljust(6), name[:22].ljust(22), series[0][0], series[-1][0], len(series)))
        time.sleep(0.35)  # 轻微限速，避免触发风控

    if results:
        batch_max = max(v[4][-1][0] for v in results.values())
        laggards = [fid for fid, v in results.items() if v[4][-1][0] < batch_max]
        if laggards:
            print("  [i] 批次末点 %s；%d 只落后，二次重试…" % (batch_max, len(laggards)))
            for fid in laggards:
                code, scheme, name, unit, old = results[fid]
                for _ in range(2):
                    time.sleep(1.2)
                    series = fetch_history(code, retries=2)
                    if series and series[-1][0] > old[-1][0]:
                        results[fid] = (code, scheme, name, unit, series)
                        break
            still = [fid for fid in laggards if results[fid][4][-1][0] < batch_max]
            if still:
                print("  [!] 重试后仍落后：%s" % ",".join(still))

    for fid, (code, scheme, name, unit, series) in results.items():
        dest = os.path.join(HIST_DIR, "%s.json" % fid)
        # 防截断/防回退：新序列比已有文件「更短」或「末点更旧」时保留原文件
        # （来源偶发只回最近若干天，或个别单位类别滞后一天）
        try:
            old = json.load(open(dest, encoding="utf-8"))
            old_s = old.get("series") or []
            if len(old_s) > len(series) or (old_s and old_s[-1][0] > series[-1][0]):
                print("  [!] %s 来源序列更短/更旧（%d 点 %s < %d 点 %s），保留原文件" %
                      (code, len(series), series[-1][0], len(old_s), old_s[-1][0] if old_s else "-"))
                series = old_s
        except Exception:  # noqa: BLE001
            pass
        obj = {
            "id": str(fid),
            "code": code,
            "name": name,
            "unit": unit,
            "scheme": scheme,
            "src": SRC_LABEL,
            "asOf": series[-1][0],
            "last": series[-1][1],
            "first": series[0][0],
            "points": len(series),
            "series": series,
        }
        with open(dest, "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        index[str(fid)] = {
            "code": code, "src": "manulife", "name": name, "unit": unit, "scheme": scheme,
            "asOf": series[-1][0], "last": series[-1][1],
            "first": series[0][0], "points": len(series),
        }
        ok += 1

    out = {
        "updatedAt": int(time.time() * 1000),
        "source": SRC_LABEL,
        "count": len(index),
        "funds": index,
    }
    with open(index_path, "w", encoding="utf-8") as fh:
        json.dump(out, fh, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：成功 %d，失败 %d；索引 %s（共 %d 只）" %
          (ok, fail, index_path, len(index)))


if __name__ == "__main__":
    main()
