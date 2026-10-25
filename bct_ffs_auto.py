# -*- coding: utf-8 -*-
"""BCT 基金便覽 —— 自动发现 + 解析（bct_ffs_auto.py）
====================================================================
回答「下次还能找到吗？能按月自动更新吗」：**按官方命名规律拼 URL 探测**，无需人工给链接。
（2026-10-19 由用户给的实例 + 官网目录结构归纳，已全部实测 200）

  ① 固定档（每季/每月原地覆盖，路径不含日期）：
      /content/dam/bcthk-sites/fact-sheet/IS_Fact_Sheet.pdf          BCT（強積金）行業計劃 12 只
      /content/dam/bcthk-sites/fact-sheet/MTS_Fact_Sheet.pdf         積金之選 24 只（含儲蓄易 2045/2050）
      /content/dam/bcthk-sites/documents/publications/images/IV_Fact_Sheet.pdf
                                                                     BCT強積金策略計劃 13 只（景順系 A/H 单位类别）
  ② 日期档（按本季/本月往前探测 4 期）：
      /content/dam/bcthk-sites/pdf/{Smart|Simple|S800}_FFS_{yyyy}Q{q}.pdf
      .../quarterly_reviews_bct_mpf_pro_choice/MTS_Fact_Sheet_Q{q}{yy}.pdf
      .../monthly_fund_factsheets_bct_mpf_strategic/Strategic-MPF-Factsheet-(A)-{yyyy}{mm}.pdf

解析复用 bct_ffs2.run_file（按**中文基金名**最长匹配，失败才回退），只补空缺、不覆盖已有更全的数据。
用法：python bct_ffs_auto.py [--dry]
"""
import datetime
import json
import os
import sys

import pdfplumber  # noqa: F401  （run_file 内部使用）
from curl_cffi import requests as cffi

import bct_ffs2

BASE = os.path.dirname(os.path.abspath(__file__))
PDFDIR = os.path.join(BASE, "tmp", "bct_auto")
HOST = "https://www.bcthk.com"

FIXED = [
    ("行業計劃", "/content/dam/bcthk-sites/fact-sheet/IS_Fact_Sheet.pdf"),
    ("積金之選", "/content/dam/bcthk-sites/fact-sheet/MTS_Fact_Sheet.pdf"),
    ("策略計劃", "/content/dam/bcthk-sites/documents/publications/images/IV_Fact_Sheet.pdf"),
]

MTS_DIR = ("/content/dam/bcthk-sites/documents/publications/investment_related_information"
           "/quarterly_reviews_bct_mpf_pro_choice")
STR_DIR = ("/content/dam/bcthk-sites/documents/publications/investment_related_information"
           "/monthly_fund_factsheets_bct_mpf_strategic")
PDF_DIR = "/content/dam/bcthk-sites/pdf"
PLANS = [("明智之選", "Smart_FFS_%dQ%d.pdf"),
         ("易富之選", "Simple_FFS_%dQ%d.pdf"),
         ("800系列", "S800_FFS_%dQ%d.pdf")]


def quarter_candidates(today, back=4):
    out, y, q = [], today.year, (today.month - 1) // 3 + 1
    for _ in range(back):
        out.append((y, q))
        q -= 1
        if q == 0:
            q, y = 4, y - 1
    return out


def month_candidates(today, back=4):
    out, y, m = [], today.year, today.month
    for _ in range(back):
        out.append((y, m))
        m -= 1
        if m == 0:
            m, y = 12, y - 1
    return out


def fetch(s, url):
    try:
        r = s.get(url, timeout=180)
        if r.status_code == 200 and r.content[:4] == b"%PDF" and len(r.content) > 50000:
            return r.content
    except Exception:
        pass
    return None


def main():
    dry = "--dry" in sys.argv
    os.makedirs(PDFDIR, exist_ok=True)
    s = cffi.Session(impersonate="chrome")
    today = datetime.date.today()
    found = []

    for plan, url in FIXED:
        data = fetch(s, HOST + url)
        if data:
            path = os.path.join(PDFDIR, os.path.basename(url))
            open(path, "wb").write(data)
            found.append((plan, os.path.basename(url), path))

    for plan, pattern in PLANS:
        for y, q in quarter_candidates(today):
            name = pattern % (y, q)
            data = fetch(s, HOST + PDF_DIR + "/" + name)
            if data:
                path = os.path.join(PDFDIR, name)
                open(path, "wb").write(data)
                found.append((plan, name, path))
                break

    for y, q in quarter_candidates(today):
        name = "MTS_Fact_Sheet_Q%d%d.pdf" % (q, y % 100)
        data = fetch(s, HOST + MTS_DIR + "/" + name)
        if data:
            path = os.path.join(PDFDIR, name)
            open(path, "wb").write(data)
            found.append(("積金之選(季報)", name, path))
            break

    for y, m in month_candidates(today):
        name = "Strategic-MPF-Factsheet-(A)-%d%02d.pdf" % (y, m)
        data = fetch(s, HOST + STR_DIR + "/" + name)
        if data:
            path = os.path.join(PDFDIR, name)
            open(path, "wb").write(data)
            found.append(("策略計劃(月報)", name, path))
            break

    print("发现 %d 份：" % len(found))
    for p, n, path in found:
        print("  %-14s %-42s %dKB" % (p, n, os.path.getsize(path) // 1024))
    if dry:
        return

    hld, FN = bct_ffs2.load()
    tot = 0
    for plan, name, path in found:
        n = bct_ffs2.run_file(path, hld, FN, quiet=True)
        tot += n
        print("  %-42s 新写入 %d" % (name, n))
    bct_ffs2.save(hld)
    print("自动解析写入 %d；holdings 共 %d" % (tot, len(hld["funds"])))


if __name__ == "__main__":
    main()
