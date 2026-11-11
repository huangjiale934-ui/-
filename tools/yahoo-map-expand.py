# -*- coding: utf-8 -*-
"""yahoo-map-expand.py —— 用晨星全库扫描结果，把「基金 → 雅虎代码」映射从 32 只扩到全部

前提：先跑 `node tools/ms-scan.js` 得到 tmp/ms-mpf.json（含 SecId/Name/PerformanceId）。
原理：
  1) 名称匹配只做「候选生成」——繁简归一 + 去掉 MPF/強積金/基金/計劃 等通用词后算字符二元组相似度；
  2) 真正的判定是**净值比对**：用候选的 PerformanceId 拼 Yahoo 代码（0P…HK），
     与该基金自己的历史净值逐日比对，要求 ≥60 个共同交易日、比值稳定（最大偏差 ≤0.8%）；
  3) 只有净值对得上的才写入 data/yahoo-map.json（宁缺勿错：映射错的后果是用别人的净值覆盖我们的）。

用法：
  python tools/yahoo-map-expand.py --dry        # 只看能配上多少
  python tools/yahoo-map-expand.py --write      # 合并进 data/yahoo-map.json
"""
import argparse
import datetime
import json
import os
import re
import statistics
import sys

from curl_cffi import requests as cffi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CAND = os.path.join(ROOT, "tmp", "ms-mpf.json")
OUT = os.path.join(ROOT, "data", "yahoo-map.json")
CACHE = os.path.join(ROOT, "tmp", "yahoo-cache2.json")
PROXIES = {"http": "http://127.0.0.1:7877", "https": "http://127.0.0.1:7877"}

try:
    from opencc import OpenCC
    T2S = OpenCC("t2s")
except Exception:
    T2S = None

# 受託人 → 名稱別名（晨星那邊的計劃名會帶發行人名，用這個先過濾，否則會出現
# 「信安亞洲債券」被配到「友邦亞洲債券」這種跨發行人的假陽性 —— 同類基金走勢太像，
# 光看比值穩定度分不出來，實測 489 天比值穩定在 0.54% 的卻是兩隻不同的基金。）
TRUSTEE_ALIAS = {
    "友邦": ["友邦"], "宏利": ["宏利"], "銀聯": ["bct", "銀聯"], "信安": ["信安"],
    "永明": ["永明"], "中國人壽": ["中國人壽", "中国人寿"], "中銀": ["中銀", "中银"],
    "東亞": ["東亞", "东亚"], "交通": ["交通"], "萬通": ["萬通", "万通"],
    "海通": ["海通"], "富達": ["富達", "富达"], "新地": ["新地"], "AMTD": ["amtd", "奧翱驁", "奥翱骜"],
    "恒生": ["恒生"], "HSBC": ["滙豐", "hsbc", "汇丰", "恒生"], "滙豐": ["滙豐", "hsbc", "汇丰", "恒生"],
}


# 品牌词：我們的名稱裡常帶發行人品牌（AMTD／BCT／景順…），而受託人欄位未必對應
# （例：AMTD 計劃的受託人是銀聯信託）。先認品牌、再退回受託人，避免整批被過濾掉。
BRANDS = ["AMTD", "BCT", "宏利", "友邦", "信安", "永明", "中銀", "中國人壽", "東亞", "交通",
          "萬通", "海通", "富達", "新地", "恒生", "滙豐", "HSBC", "景順", "安聯", "我的"]


def brands_in(text):
    t = str(text or "")
    low = t.lower()
    return {b for b in BRANDS if b.lower() in low}


def trustee_ok(trustee, ms_name, our_name=""):
    """我們這隻基金與晨星候選是否屬於同一家／同一品牌"""
    low = str(ms_name or "").lower()
    ours = brands_in(our_name)
    if ours:
        return any(b.lower() in low for b in ours)
    t = str(trustee or "")
    for key, aliases in TRUSTEE_ALIAS.items():
        if key in t:
            return any(a in low for a in aliases)
    return True


STOP = ["强积金", "強積金", "mpf", "基金", "计划", "計劃", "信托", "信託", "优选", "優選",
        "退休精选", "退休精選", "环球精选", "環球精選", "雇员选择", "僱員選擇", "集成信托", "集成信託",
        "constituent", "fund", "scheme", "plan"]


def norm(s):
    s = str(s or "")
    if T2S:
        s = T2S.convert(s)
    s = s.lower()
    for k in STOP:
        s = s.replace(k, "")
    s = re.sub(r"[\s\-–—－·（）()\[\]【】,，.。、/|_+]", "", s)
    s = re.sub(r"[（(][^）)]*[）)]", "", s)
    return s


def bigrams(s):
    return {s[i:i + 2] for i in range(len(s) - 1)} if len(s) > 1 else {s}


def score(a, b):
    A, B = bigrams(a), bigrams(b)
    if not A or not B:
        return 0.0
    inter = len(A & B)
    return 2.0 * inter / (len(A) + len(B))


def yahoo_series(perf, cache):
    if perf in cache:
        return cache[perf]
    sym = perf + ".HK"
    r = cffi.get("https://query1.finance.yahoo.com/v8/finance/chart/" + sym,
                 params={"range": "2y", "interval": "1d"}, impersonate="chrome",
                 proxies=PROXIES, timeout=40)
    d = r.json()["chart"]["result"][0]
    ts = d.get("timestamp") or []
    cl = (d["indicators"]["quote"][0].get("close") or [])
    out = {}
    for t, c in zip(ts, cl):
        if c is None:
            continue
        day = datetime.datetime.fromtimestamp(t, datetime.timezone(datetime.timedelta(hours=8))).strftime("%Y-%m-%d")
        out[day] = float(c)
    cache[perf] = out
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--write", action="store_true")
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--maxdev", type=float, default=0.0005)   # 只收「逐日完全相同」的映射（实测同源数据偏差 0.000%）
    a = ap.parse_args()

    cands = json.load(open(CAND, encoding="utf-8"))
    cands = [c for c in cands if c.get("perfId")]
    print("候選（有 PerformanceId）：%d 只" % len(cands))
    for c in cands:
        c["n"] = norm(c["name"])

    funds = json.load(open(os.path.join(ROOT, "data", "funds.json"), encoding="utf-8"))["funds"]
    try:
        cache = json.load(open(CACHE, encoding="utf-8"))
    except Exception:
        cache = {}
    try:
        existing = json.load(open(OUT, encoding="utf-8")).get("funds", {})
    except Exception:
        existing = {}

    out = dict(existing)
    ok = bad = 0
    for f in funds:
        fid = str(f["id"])
        if fid in out:
            continue
        name = f.get("fundBase") or f.get("fund") or ""
        n = norm(name)
        # 「強積金保守基金」去掉通用词后只剩「保守」两个字，旧门槛 (>=3) 会把这类整批跳过
        if len(n) < 2:
            continue
        pool = [c for c in cands if trustee_ok(f.get("trustee"), c["name"], name)]
        scored = sorted(((score(n, c["n"]), c) for c in pool), key=lambda x: -x[0])[:4]
        if not scored or scored[0][0] < 0.45:
            continue
        try:
            hist = json.load(open(os.path.join(ROOT, "data", "hist", fid + ".json"), encoding="utf-8"))
        except Exception:
            continue
        ours = dict((d, p) for d, p in hist.get("series", []))
        if len(ours) < 30:
            continue

        best = None
        for sc, c in scored:
            if sc < 0.45:
                break
            try:
                ser = yahoo_series(c["perfId"], cache)
            except Exception:
                continue
            common = sorted(set(ours) & set(ser))
            if len(common) < 60:
                continue
            ratios = [ours[d] / ser[d] for d in common if ser[d]]
            if not ratios:
                continue
            med = statistics.median(ratios)
            dev = max(abs(r / med - 1) for r in ratios)
            # 两档门槛：名称很像（>=0.55）允许 0.05% 偏差；名称只算勉强对上（0.45-0.55）
            # 必须近乎完全一致（0.02%），避免把两只走势相似但不同的基金配错。
            limit = a.maxdev if sc >= 0.55 else min(a.maxdev, 0.0002)
            if dev <= limit and (best is None or dev < best[2]):
                best = (c, med, dev, len(common), sc)

        if best:
            c, med, dev, ncom, sc = best
            out[fid] = {"ticker": c["perfId"] + ".HK", "ratio": round(med, 6), "samples": ncom,
                        "maxDev": round(dev, 5), "name": name, "msName": c["name"], "nameScore": round(sc, 3)}
            ok += 1
            print("OK  %-28s → %-14s %-30s 天数%4d 比值%.4f 偏差%.3f%%"
                  % (name[:28], c["perfId"], c["name"][:30], ncom, med, dev * 100))
        else:
            bad += 1

    # 一個 Yahoo 代碼只能對應一隻（否則說明名稱匹配撞車，取偏差最小的一隻）
    best_by_ticker = {}
    for fid, v in list(out.items()):
        t = v["ticker"]
        if t not in best_by_ticker or v["maxDev"] < best_by_ticker[t]["maxDev"]:
            best_by_ticker[t] = v
    kept = {fid: v for fid, v in out.items() if best_by_ticker.get(v["ticker"]) is v}
    dropped = len(out) - len(kept)
    out = kept
    if dropped:
        print("去重：%d 只映射撞到同一個代碼，已丟棄（保留偏差最小的）" % dropped)

    print("新增 %d，未配上 %d，合计 %d / %d 只" % (ok, bad, len(out), len(funds)))
    json.dump(cache, open(CACHE, "w", encoding="utf-8"), ensure_ascii=False)
    if a.write and not a.dry:
        json.dump({"updatedAt": int(datetime.datetime.now().timestamp() * 1000), "funds": out},
                  open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
        print("已寫入 " + OUT)
    return 0


if __name__ == "__main__":
    sys.exit(main())
