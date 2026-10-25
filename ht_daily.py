# -*- coding: utf-8 -*-
"""海通日度净值入库（ht_daily.py）—— 官网 PerformanceChart API
====================================================================
发现路径（2026-10-18）：
1. 列表页 https://gthtam.com.hk/mpf/zh-cht 服务端渲染含 7 只基金卡 + 「詳情」按钮
2. 详情页 /mpf/zh-cht/MPF/Product/<段> 需 cookie mpf_disclaimer_popup=yes（否则 302 回列表页）
3. 图表数据 API：POST /mpf/zh-CHT/MPF/PerformanceChart/<段>?selectedClass=<1=A|4=T>&dfrom=&dto=
   → JSON [labels[], values[]]，日期格式「2012年9月19日」，空 dfrom/dto = 全量
保守基金 A 类实测 3427 点（2012-09-19 ~ 2026-10-15），末值 12.6 与列表页一致。
"""
import json
import os
import re
import time

from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")

# 详情页 URL 段 → 基金名核心
SEG2CORE = {
    "Haitong_Age_65_Plus_Fund": "65歲後",
    "Haitong_Asia_Pacific_Fund": "亞太",
    "Haitong_Core_Accumulation_Fund": "核心累積",
    "Haitong_Global_Diversification_Fund": "環球分散",
    "Haitong_HongKong_SAR_Fund": "香港特區",
    "Haitong_Korea_Fund": "韓國",
    "Haitong_MPF_Conservative_Fund": "強積金保守",
}
CLASS2TYPE = {"1": "A", "4": "T"}  # selectedClass → 单位类别


def cn_date_to_iso(s):
    m = re.match(r"(\d{4})年(\d{1,2})月(\d{1,2})日", s or "")
    if not m:
        return None
    return "%s-%02d-%02d" % (m.group(1), int(m.group(2)), int(m.group(3)))


def main():
    s = cffi.Session(impersonate="chrome")
    s.get("https://gthtam.com.hk/mpf/zh-cht", headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
    s.cookies.set("mpf_disclaimer_popup", "yes", domain="gthtam.com.hk")
    s.cookies.set("Lang4hti_asm", "zh-CHT", domain="gthtam.com.hk")

    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ht = [x for x in FN if "海通" in (x.get("scheme") or "")]
    idx = json.load(open(INDEX, encoding="utf-8"))
    ok = skip = 0
    for seg, core in SEG2CORE.items():
        for cls, unit in CLASS2TYPE.items():
            mine = [x for x in ht if core in (x.get("fundBase") or x.get("fund")) and x.get("unit") == unit]
            if not mine:
                continue
            x = mine[0]
            url = ("https://gthtam.com.hk/mpf/zh-CHT/MPF/PerformanceChart/%s"
                   "?selectedClass=%s&dfrom=&dto=" % (seg, cls))
            try:
                r = s.post(url, headers={
                    "User-Agent": "Mozilla/5.0",
                    "Referer": "https://gthtam.com.hk/mpf/zh-cht/MPF/Product/" + seg,
                    "Content-Type": "application/json; charset=utf-8",
                    "Accept": "application/json, text/javascript, */*; q=0.01",
                    "X-Requested-With": "XMLHttpRequest",
                }, timeout=60)
                d = r.json()
                labels, values = d[0], d[1]
                series = []
                for lb, v in zip(labels, values):
                    iso = cn_date_to_iso(lb)
                    if iso and v is not None:
                        series.append([iso, round(float(v), 4)])
                series.sort(key=lambda p: p[0])
                if len(series) < 100:
                    print("✘ #%s %s-%s：仅 %d 点" % (x["id"], core, unit, len(series)))
                    skip += 1
                    continue
                obj = {
                    "id": x["id"], "code": seg, "name": x.get("fundBase", x["fund"]),
                    "unit": x.get("unit", ""), "scheme": x.get("scheme", ""),
                    "src": "海通國際官網 PerformanceChart API（逐日單位價格）",
                    "note": "海通国际投资经理官网基金详情页「過往基金價格」图表接口",
                    "asOf": series[-1][0], "last": series[-1][1], "first": series[0][0],
                    "points": len(series), "series": series,
                }
                with open(os.path.join(HIST, "%s.json" % x["id"]), "w", encoding="utf-8") as fh:
                    json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
                idx["funds"][str(x["id"])] = {
                    "code": seg, "src": "haitong-perfchart", "name": obj["name"],
                    "unit": obj["unit"], "scheme": obj["scheme"], "asOf": obj["asOf"],
                    "last": obj["last"], "first": obj["first"], "points": len(series),
                }
                ok += 1
                print("✔ #%s %s-%s ← %s（%d 点，%s ~ %s）" % (
                    x["id"], core, unit, seg, len(series), series[0][0], series[-1][0]), flush=True)
            except Exception as e:
                print("✘ #%s %s-%s: %s" % (x["id"], core, unit, str(e)[:60]), flush=True)
                skip += 1
            time.sleep(0.5)
    idx["count"] = len(idx["funds"])
    idx["updatedAt"] = int(time.time() * 1000)
    json.dump(idx, open(INDEX, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("完成：OK %d / skip %d；hist-index 共 %d 只" % (ok, skip, len(idx["funds"])))


if __name__ == "__main__":
    main()
