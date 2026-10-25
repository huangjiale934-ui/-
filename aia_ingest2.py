# -*- coding: utf-8 -*-
"""AIA 日度净值入库 v2（aia_ingest2.py）—— 全量 21 只，修复 131/133 错配
====================================================================
依据 aia_enum.py 全空间枚举结果（tmp/aia_codes.json，37 有效码）：
- 名称精确匹配 ours 451 清单友邦 21 只
- 3A/3C 是「富達穩定資本基金/富達增長基金」（舊富達类别，止 2023-06）——并非我们的
  「穩定資本組合/增長組合」；正确码为 V3/W3（9309 点，2000-12 起）。本脚本覆盖修复。
用法：python aia_ingest2.py
"""
import json
import os
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
CODES = os.path.join(BASE, "aia_codes.json")

s = cffi.Session(impersonate="chrome")
H = {"Referer": "https://www.aia.com.hk/", "Accept": "application/json", "Accept-Language": "zh-HK"}

# AIA 官網碼 → 我們的基金 id（名称核对一致；3A/3C 已剔除）
MANUAL = {
    "NA": "1520",   # 65歲後基金（DIS）
    "NF": "1519",   # 核心累積基金（DIS）
    "3G": "878",    # 美洲基金
    "3E": "876",    # 亞歐基金
    "3D": "875",    # 亞洲債券基金
    "3H": "1579",   # 中港動態資產配置基金
    "3J": "2379",   # 退休收益基金
    "3F": "877",    # 中港基金
    "D3": "102",    # 大中華股票基金
    "L3": "137",    # 亞洲股票基金
    "N3": "142",    # 北美股票基金
    "E3": "145",    # 歐洲股票基金
    "63": "657",    # 環球債券基金
    "83": "658",    # 全球基金
    "93": "699",    # 基金經理精選退休基金
    "53": "141",    # 綠色退休基金
    "B3": "132",    # 均衡組合
    "T3": "146",    # 保證組合
    "R3": "134",    # 強積金保守基金
    "V3": "131",    # 穩定資本組合（修复：原 3A 错配富達舊基金）
    "W3": "133",    # 增長組合（修复：原 3C 错配富達舊基金）
}


def main():
    found = json.load(open(CODES, encoding="utf-8"))
    by_code = {x["code"]: x for x in found}
    FN = {str(x["id"]): x for x in json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]}
    idx = json.load(open(INDEX, encoding="utf-8"))
    ok = skip = fix = 0
    for code, fid in MANUAL.items():
        meta = by_code.get(code)
        if not meta or meta.get("nPoints", 0) <= 0 or fid not in FN:
            print("✘ %s：枚举无此码或 id 不存在" % code)
            skip += 1
            continue
        x = FN[fid]
        nm_api = (meta.get("nameChi") or "").replace("友邦強積金優選計劃 - ", "")
        nm_our = x.get("fundBase") or x.get("fund")
        if nm_api != nm_our:
            print("⚠ 名稱不一致 api=%r ours=%r（仍按映射寫入）" % (nm_api, nm_our))
        try:
            r = s.get("https://www3.aia-pt.com.hk/common_ws/aiapt/FundPrice/getFundDetails/" + code,
                      headers=H, timeout=45)
            j = r.json()
            pd = j.get("priceDetails") or []
            if len(pd) < 5:   # 2026-10-22：放宽门槛（历史完整性由快照合并保证）
                print("✘ #%s %s：priceDetails 僅 %d" % (fid, nm_our[:16], len(pd)))
                skip += 1
                continue
            series = []
            for p in pd:
                d = p.get("pdate") or ""
                if len(d) == 8:
                    series.append(["%s-%s-%s" % (d[:4], d[4:6], d[6:8]), round(float(p.get("price")), 4)])
            series.sort(key=lambda x: x[0])
            oldp = idx["funds"].get(str(fid), {}).get("points", 0)
            obj = {
                "id": int(fid), "code": code, "name": nm_our,
                "unit": x.get("unit", ""), "scheme": x.get("scheme", ""),
                "src": "友邦官網價格搜尋（aia-pt API，逐日）",
                "note": "友邦官網過往價格搜尋 API 的逐日單位價格",
                "asOf": series[-1][0], "last": series[-1][1], "first": series[0][0],
                "points": len(series), "series": series,
            }
            with open(os.path.join(HIST, "%s.json" % fid), "w", encoding="utf-8") as fh:
                json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
            idx["funds"][str(fid)] = {
                "code": code, "src": "aia-pt", "name": nm_our, "unit": obj["unit"],
                "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                "first": obj["first"], "points": len(series),
            }
            if oldp and oldp != len(series):
                fix += 1
            ok += 1
            print("✔ #%s %s ← %s（%d 点，%s ~ %s）" % (fid, nm_our[:18], code, len(series), series[0][0], series[-1][0]), flush=True)
        except Exception as e:
            print("✘ #%s %s" % (fid, str(e)[:50]), flush=True)
        time.sleep(0.4)
    idx["count"] = len(idx["funds"])
    idx["updatedAt"] = int(time.time() * 1000)
    json.dump(idx, open(INDEX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：OK %d / skip %d / 修複 %d；hist-index 共 %d 只" % (ok, skip, fix, len(idx["funds"])))


if __name__ == "__main__":
    main()
