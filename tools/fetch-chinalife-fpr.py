# -*- coding: utf-8 -*-
"""中國人壽「基金表現便覽」下载（tools/fetch-chinalife-fpr.py）—— 2026-11-22
====================================================================
用户要求：不要再用積金局轉載的 MT00083（转手一次会更晚），改发行人官网。
官网下载中心 https://chinalife.com.hk/zh-cn/products/mpf/download-centre（简中版季度最全；繁中版落后一季）
「基金表現便覽」区块按季度列出（FPR_2026_2 = 2026 年第 2 季…），取列表第一条即最新。

输出：tmp/cl_fpr.pdf（成功）/ 失败时回退下載積金局 MT00083 并标记 FALLBACK
用法：python tools/fetch-chinalife-fpr.py [--dry]
"""
import os
import sys

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "tmp", "cl_fpr.pdf")
PAGE = "https://chinalife.com.hk/zh-cn/products/mpf/download-centre"
FALLBACK = "https://www.mpfa.org.hk/assets/FF/MT00083.pdf"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36"


def pick_pdf(html):
    """在「基金表現便覽」区块里取**季度最新**的一条（按标题里的「YYYY年第N季」排序，
    不依赖 DOM 顺序 —— 实测第一条是 FPR_latest/2026 Q1，Q2 反而在后面）。"""
    import re
    i = html.find("基金表現便覽")
    if i < 0:
        i = html.find("基金表现便览")
    if i < 0:
        return None, None
    seg = html[i:i + 12000]
    blocks = re.findall(r'<li class="row">([\s\S]*?)</li>', seg)
    best, best_key = None, (-1, -1)
    for b in blocks:
        mm = re.search(r'href="([^"]+\.pdf[^"]*)"', b, re.I)
        if not mm:
            continue
        title = re.sub(r"<[^>]+>", "", b)
        title = re.sub(r"\s+", " ", title).strip()
        q = re.search(r"(20\d{2})\s*年\s*(?:第)?\s*([1-4])\s*季", title)
        key = (int(q.group(1)), int(q.group(2))) if q else (0, 0)
        href = mm.group(1)
        if href.startswith("/"):
            href = "https://www.chinalife.com.hk" + href
        if key > best_key:
            best, best_key = (href, title[:60]), key
    return best if best else (None, None)


def download(url, path):
    r = cffi.get(url, impersonate="chrome", timeout=90, headers={"User-Agent": UA})
    if r.status_code != 200 or len(r.content) < 50000:
        return False
    with open(path, "wb") as f:
        f.write(r.content)
    return True


def main():
    dry = "--dry" in sys.argv
    url, title = None, None
    try:
        r = cffi.get(PAGE, impersonate="chrome", timeout=60, headers={"User-Agent": UA})
        if r.status_code == 200:
            url, title = pick_pdf(r.text)
    except Exception as e:  # noqa: BLE001
        print("WARN 官網頁面讀取失敗：%s" % str(e)[:80])

    if url:
        print("官網最新便覽：%s（%s）" % (title or "-", url))
        if dry:
            return 0
        if download(url, OUT):
            print("OK 已下載官網 PDF → %s" % OUT)
            return 0
        print("WARN 官網 PDF 下載失敗，改用積金局 MT00083")
    else:
        print("WARN 官網未找到便覽連結，改用積金局 MT00083")

    if dry:
        return 0
    if not download(FALLBACK, OUT):
        print("FAIL 回退 PDF 也下載失敗")
        return 1
    print("FALLBACK 已下載積金局 MT00083 → %s" % OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
