# -*- coding: utf-8 -*-
"""
交通银行（愉盈退休强积金计划）历史净值 —— 官网 pricedata.js 全量数据
====================================================================
数据源：https://www.bocomtrust.com.hk/BankCommSite/shtml/trust/tw/trust/js/pricedata.js（5.4MB）
  · pricedate[i]           = "YYYY-MM-DD"（约 6385 个估值日，倒序）
  · bidprice["YYYY-MM-DD-<code>"] / offerprice[...] = 值（按日 + 基金代码键控）
  · fundcode[] / fundChiName[] —— 14 只成分基金
页面：/BankCommSite/shtml/trust/tw/2600764/2600785/2600787/2600908/2600910/list.shtml
输出：data/hist/<id>.json（src=bocom）+ 合并 data/hist-index.json
用法：python fetch-bocom-hist.py
"""
import json
import os
import re
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
URL = "https://www.bocomtrust.com.hk/BankCommSite/shtml/trust/tw/trust/js/pricedata.js"
CACHE = os.path.join(BASE, "tmp", "bocom_pricedata.js")
SRC = "交通銀行信託官網（愉盈退休強積金計劃）"


def main():
    if not os.path.exists(CACHE):
        print("下载 pricedata.js（5.4MB）…", flush=True)
        r = cffi.get(URL, impersonate="chrome", timeout=180)
        r.raise_for_status()
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        open(CACHE, "w", encoding="utf-8").write(r.text)
    t = open(CACHE, encoding="utf-8").read()

    dates = re.findall(r'pricedate\[\d+\]\s*=\s*"([\d-]+)"', t)
    prices = dict(re.findall(r'(?:bid|offer)price\["([\d-]+-[0-9A-Za-z]+)"\]\s*=\s*"([\d.]+)"', t))
    codes = re.findall(r'fundcode\s*=\s*new Array\(([^)]*)\)', t)
    code_list = [x.strip('" ') for x in codes[0].split(",")] if codes else []
    names = re.findall(r'fundChiName\s*=\s*new Array\(([^;]*)\);', t)
    name_list = re.findall(r'"([^"]+)"', names[0]) if names else []
    print("估值日 %d 个 · 价格点 %d · 基金 %d 只" % (len(dates), len(prices), len(code_list)), flush=True)
    if len(code_list) != len(name_list):
        print("!! 代码/名称数量不一致，请人工检查")
        return

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ours = {x["fund"]: x for x in funds if x.get("trustee") == "交通"}

    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}
    saved = 0
    for code, nm in zip(code_list, name_list):
        x = ours.get(nm)
        if not x:
            print("  [!] %s 未匹配我方基金" % nm)
            continue
        pts = []
        for d in dates:
            v = prices.get(d + "-" + code)
            if v:
                pts.append([d, float(v)])
        if len(pts) < 20:
            print("  [!] %s 点数不足（%d）" % (nm, len(pts)))
            continue
        pts.sort()
        fid = str(x["id"])
        obj = {"id": fid, "code": code, "name": nm, "unit": x.get("unit", ""),
               "scheme": x.get("scheme", ""), "src": SRC,
               "note": "官網 pricedata.js（贖回價，逐日）",
               "asOf": pts[-1][0], "last": pts[-1][1], "first": pts[0][0],
               "points": len(pts), "series": pts}
        with open(os.path.join(HIST_DIR, fid + ".json"), "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, separators=(",", ":"))
        idx[fid] = {"code": code, "src": "bocom", "name": nm, "unit": obj["unit"],
                    "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                    "first": obj["first"], "points": obj["points"]}
        saved += 1
        print("  ✓ %s：%s → %s · %d 点" % (nm, pts[0][0], pts[-1][0], len(pts)), flush=True)
    with open(INDEX, "w", encoding="utf-8") as f:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系 + 中银保诚 + 中国人寿 + 永明 + 交通银行）",
                   "count": len(idx), "funds": idx}, f, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：写入 %d 只（hist-index 共 %d）" % (saved, len(idx)))


if __name__ == "__main__":
    main()
