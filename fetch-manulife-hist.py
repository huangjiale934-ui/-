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

    ok = fail = 0
    for i, (fid, code, scheme, name, unit) in enumerate(tasks, 1):
        series = fetch_history(code)
        if not series or len(series) < 30:
            fail += 1
            print("  %2d/%d  %s %s  [无数据/过短，跳过]" % (i, len(tasks), code, name))
            continue
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
        with open(os.path.join(HIST_DIR, "%s.json" % fid), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        index[str(fid)] = {
            "code": code, "src": "manulife", "name": name, "unit": unit, "scheme": scheme,
            "asOf": series[-1][0], "last": series[-1][1],
            "first": series[0][0], "points": len(series),
        }
        ok += 1
        print("  %2d/%d  %s %s   %s → %s (%d 点)" %
              (i, len(tasks), code.ljust(6), name[:22].ljust(22), series[0][0], series[-1][0], len(series)))
        time.sleep(0.35)  # 轻微限速，避免触发风控

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
