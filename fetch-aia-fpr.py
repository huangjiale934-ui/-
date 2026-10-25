# -*- coding: utf-8 -*-
"""
友邦（AIA）历史净值 —— 官网《基金表現概覽》(FPR) 月刊 PDF
====================================================================
数据源：aia.com.hk 存档 PDF（2023-01 起可用，月末数据）：
  https://www.aia.com.hk/content/dam/hk-wise/pdf/form-library/form-and-guides/employer/forms/
  aia-mpf-prime-value-choice-fund-performance-review-{mon}-{year}.pdf
每只基金页含「基金資料 FUND FACTS」：
  單位資產淨值（月末）· 基金總值（百万港元，即 AUM）· 基金開支比率（FER）· 基金風險標記
输出：
  · data/hist/<id>.json（**月度**序列，src=aia）→ 合并 data/hist-index.json
  · data/aia-facts.json（规模/ FER / 风险标记，官网口径，供后续「规模实时化」）
用法：
  python fetch-aia-fpr.py                # 2023-01 起全量
  python fetch-aia-fpr.py --from 2024-06
"""
import datetime as dt
import json
import os
import re
import sys
import time

from curl_cffi import requests as cffi
from pypdf import PdfReader

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HIST_DIR = os.path.join(DATA, "hist")
INDEX = os.path.join(DATA, "hist-index.json")
CACHE = os.path.join(BASE, "tmp", "aia_fpr")
URL = ("https://www.aia.com.hk/content/dam/hk-wise/pdf/form-library/form-and-guides/employer/forms/"
       "aia-mpf-prime-value-choice-fund-performance-review-%s-%d.pdf")
SRC = "友邦官網 FPR 月刊（月末）"
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}
MON = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]


def norm(s):
    return re.sub(r"[\s\^＊*#+]+", "", str(s or ""))


def parse_pdf(path):
    """返回 {基金名: {date, nav, sizeM, fer, risk}}"""
    out = {}
    r = PdfReader(path)
    for pg in r.pages:
        t = pg.extract_text() or ""
        if "單位資產淨值" not in t or "基金資料" not in t:
            continue
        m_name = re.search(r"截至\d{4}年\d{1,2}月\d{1,2}日[^\n]*\n([^\n]+)", t)
        m_date = re.search(r"截至\s*(\d{4})年(\d{1,2})月(\d{1,2})日", t)
        if not (m_name and m_date):
            continue
        name = norm(m_name.group(1))
        date = "%04d-%02d-%02d" % (int(m_date.group(1)), int(m_date.group(2)), int(m_date.group(3)))
        seg = t[t.find("Fund Descriptor"):] if "Fund Descriptor" in t else t
        # pypdf 抽取的数值前常带 \x03 控制字符，先清洗
        vals = [re.sub(r"[\x00-\x1f\x7f]", "", v).strip()
                for v in re.findall(r"[：:]\s*([^\n：]+)", seg)][:6]
        nav = size = fer = risk = None
        for v in vals:
            m = re.match(r"HK\$\s*([\d,\.]+)", v)
            if m:
                x = float(m.group(1).replace(",", ""))
                if nav is None:
                    nav = x
                elif size is None:
                    size = x
            elif fer is None and re.match(r"^[\d\.]+%$", v):
                fer = float(v.rstrip("%"))
        for v in vals:
            m = re.match(r"^([\d\.]+)%$", v)
            if m and fer is not None and abs(float(m.group(1)) - fer) > 1e-9 and risk is None:
                risk = float(m.group(1))
        if nav and nav > 0:
            out[name] = {"date": date, "nav": nav, "sizeM": size, "fer": fer, "risk": risk}
    return out


def main():
    start = (2023, 1)
    if "--from" in sys.argv:
        y, m = sys.argv[sys.argv.index("--from") + 1].split("-")
        start = (int(y), int(m))
    os.makedirs(CACHE, exist_ok=True)

    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    ours = {}
    for x in funds:
        if x.get("trustee") == "友邦信託" and x.get("navStatus") != "na":
            ours[norm(x["fund"])] = x

    # 生成月份序列（start → 上个月）
    today = dt.date.today()
    months = []
    y, m = start
    while (y, m) <= (today.year, today.month):
        months.append((y, m))
        m += 1
        if m == 13:
            y, m = y + 1, 1

    all_data = {}   # fundId -> {date: {nav,sizeM,fer,risk}}
    fetched = skipped = 0
    for (y, m) in months:
        key = "%s-%d" % (MON[m - 1], y)
        pdf = os.path.join(CACHE, key + ".pdf")
        if not os.path.exists(pdf):
            try:
                r = cffi.get(URL % (MON[m - 1], y), headers=UA, impersonate="chrome", timeout=90)
                if r.status_code != 200 or len(r.content) < 100000:
                    skipped += 1
                    time.sleep(0.4)
                    continue
                open(pdf, "wb").write(r.content)
            except Exception:  # noqa: BLE001
                skipped += 1
                continue
        fetched += 1
        try:
            pages = parse_pdf(pdf)
        except Exception as e:  # noqa: BLE001
            print("  [!] %s 解析失败 %s" % (key, str(e)[:80]))
            continue
        hit = 0
        for name, v in pages.items():
            x = ours.get(name)
            if not x:
                continue
            all_data.setdefault(str(x["id"]), {})[v["date"]] = v
            hit += 1
        print("  %s：解析 %d 只基金页（匹配我方 %d）" % (key, len(pages), hit), flush=True)
        time.sleep(0.2)

    # 组装
    idx = {}
    if os.path.exists(INDEX):
        try:
            idx = json.load(open(INDEX, encoding="utf-8")).get("funds", {})
        except Exception:  # noqa: BLE001
            idx = {}
    facts = {"updatedAt": int(time.time() * 1000), "source": SRC, "count": 0, "funds": {}}
    saved = 0
    for fid, dmap in all_data.items():
        arr = sorted([(d, v["nav"]) for d, v in dmap.items()])
        if len(arr) < 6:
            continue
        x = next((t for t in funds if str(t["id"]) == fid), None)
        if not x:
            continue
        obj = {
            "id": fid, "code": "", "name": x["fund"], "unit": x.get("unit", ""),
            "scheme": x.get("scheme", ""), "src": SRC,
            "note": "官網《基金表現概覽》月刊（月末淨值，月度頻率）",
            "asOf": arr[-1][0], "last": arr[-1][1], "first": arr[0][0],
            "points": len(arr), "series": [[d, p] for d, p in arr],
        }
        with open(os.path.join(HIST_DIR, "%s.json" % fid), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, ensure_ascii=False, separators=(",", ":"))
        idx[fid] = {"code": "", "src": "aia", "name": x["fund"], "unit": x.get("unit", ""),
                    "scheme": obj["scheme"], "asOf": obj["asOf"], "last": obj["last"],
                    "first": obj["first"], "points": obj["points"]}
        last = dmap[arr[-1][0]]
        facts["funds"][fid] = {"asOf": arr[-1][0], "nav": arr[-1][1],
                               "sizeM": last.get("sizeM"), "fer": last.get("fer"), "risk": last.get("risk")}
        saved += 1
    facts["count"] = len(facts["funds"])
    with open(os.path.join(DATA, "aia-facts.json"), "w", encoding="utf-8") as fh:
        json.dump(facts, fh, ensure_ascii=False, separators=(",", ":"))
    with open(INDEX, "w", encoding="utf-8") as fh:
        json.dump({"updatedAt": int(time.time() * 1000),
                   "source": "各发行人官网（宏利 + BCT + 友邦 + HSBC系）",
                   "count": len(idx), "funds": idx}, fh, ensure_ascii=False, separators=(",", ":"))
    print("\n完成：FPR 解析 %d 个月（跳过 %d）· 写入 %d 只友邦基金（hist-index 共 %d）" % (fetched, skipped, saved, len(idx)))


def parse_holdings_page(t):
    """从 FPR 基金页文本解析 前十大持仓 与 资产分布（名称+权重）。"""
    import re as _re
    t = _re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", t)   # 保留 \t \n \r（此前误删换行导致整页一行）
    out = {"top10": [], "alloc": [], "asOf": ""}
    m_date = _re.search(r"截至(\d{4})年(\d{1,2})月(\d{1,2})日", t)
    if m_date:
        out["asOf"] = "%04d-%02d-%02d" % (int(m_date.group(1)), int(m_date.group(2)), int(m_date.group(3)))
    # —— 前十大持仓 ——
    i = t.find("TOP TEN HOLDINGS")
    if i >= 0:
        seg = t[i:i + 2000]
        for ln in seg.split("\n")[1:]:
            ln = ln.strip()
            if ("佔資產淨值百分比" in ln) or ("% of NAV" in ln) or (not ln):
                if out["top10"]:
                    break
                continue
            m = _re.match(r"^(.*?)\s*([\d.]+)%$", ln)
            if not m:
                if out["top10"]:
                    break
                continue
            name = m.group(1).strip()
            w = float(m.group(2))
            cn = _re.match(r"^([\u4e00-\u9fff][\u4e00-\u9fff0-9A-Za-z\s\-\(\)\uff08\uff09]*?)(?=\s+[A-Z][A-Z&\.\- ]{2,}|\s*$)", name)
            disp = cn.group(1).strip() if cn else name
            out["top10"].append({"name": disp, "weight": w})
            if len(out["top10"]) >= 10:
                break
    # —— 官方累积回报（基金表現表：中文被字体混淆，改用英文定位 + 第一行数字）——
    out["cum"] = {}
    k = t.find("NAV to NAV")
    if k < 0:
        k = t.find("FUND PERFORMANCE")
    if k >= 0:
        seg2 = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", " ", t[k:k + 420])
        for ln2 in seg2.split("\n"):
            nums = _re.findall(r"-?\d+\.\d+", ln2)
            if len(nums) >= 5:
                keys = ["y1", "y3", "y5", "y10", "since", "ytd"]
                for i2, key in enumerate(keys):
                    if i2 < len(nums):
                        out["cum"][key] = float(nums[i2])
                break
    # —— 资产分布 ——
    a = t.find("ASSET ALLOCATION")
    if a >= 0:
        head = t[max(0, a - 600):a]
        tail = t[a:a + 900]
        labels = []
        for ln in tail.split("\n")[1:]:
            ln = ln.strip()
            if not ln:
                continue
            if ("基金經理報告" in ln) or ("FUND MANAGER" in ln) or ("TOP TEN" in ln):
                break
            if _re.search(r"[\u4e00-\u9fff]", ln):
                cn2 = _re.match(r"^([\u4e00-\u9fff0-9\-\(\)\u00b7\s]{2,20})(?:\s+[A-Za-z].*)?$", ln)
                labels.append(cn2.group(1).strip() if cn2 else ln)
        pcts = [float(x) for x in _re.findall(r"(\d+\.\d{2})%", head)]
        if labels and len(pcts) > len(labels):
            pcts = pcts[-len(labels):]
        if labels and pcts and abs(len(labels) - len(pcts)) <= 1:
            n2 = min(len(labels), len(pcts))
            out["alloc"] = [{"label": labels[i2], "weight": pcts[i2]} for i2 in range(n2)]
    return out


def merge_holdings():
    """用最新缓存月份为每只命中基金写 holdings（src=aia）。"""
    idx_ok = os.path.exists(INDEX)
    _ = idx_ok
    ours = {}
    funds = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    for x in funds:
        if x.get("trustee") == "友邦信託" and x.get("navStatus") != "na":
            ours[norm(x["fund"])] = x
    hld = {"updatedAt": 0, "source": "宏利官网基金详情（季度） + 友邦 FPR 月刊（月末）", "count": 0, "funds": {}}
    p = os.path.join(DATA, "holdings.json")
    if os.path.exists(p):
        try:
            hld = json.load(open(p, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    pdfs = sorted([f for f in os.listdir(CACHE) if f.endswith(".pdf")])
    perf = {"updatedAt": 0, "source": "发行人官网", "count": 0, "funds": {}}
    pp = os.path.join(DATA, "trustee-perf.json")
    if os.path.exists(pp):
        try:
            perf = json.load(open(pp, encoding="utf-8"))
        except Exception:  # noqa: BLE001
            pass
    ok = ok_p = 0
    for fn in pdfs:
        try:
            r = PdfReader(os.path.join(CACHE, fn))
        except Exception:  # noqa: BLE001
            continue
        for pg in r.pages:
            t = pg.extract_text() or ""
            if "單位資產淨值" not in t or "基金資料" not in t:
                continue
            m_name = re.search(r"截至\d{4}年\d{1,2}月\d{1,2}日[^\n]*\n([^\n]+)", t)
            if not m_name:
                continue
            x = ours.get(norm(m_name.group(1)))
            if not x:
                continue
            h = parse_holdings_page(t)
            fid = str(x["id"])
            if h["top10"] or h["alloc"]:
                old = hld["funds"].get(fid)
                if not (old and old.get("asOf") and h["asOf"] and old["asOf"] >= h["asOf"]):
                    hld["funds"][fid] = {"asOf": h["asOf"], "top10": h["top10"], "alloc": h["alloc"], "src": "aia"}
                    ok += 1
            # 官方累积回报（只保留最新月份）
            cum = h.get("cum") or {}
            if cum:
                oldp = perf["funds"].get(fid)
                if not (oldp and oldp.get("asOf") and h["asOf"] and oldp["asOf"] >= h["asOf"] and oldp.get("src") == "aia"):
                    entry = {"src": "aia", "asOf": h["asOf"]}
                    entry.update(cum)
                    perf["funds"][fid] = entry
                    ok_p += 1
    hld["updatedAt"] = int(time.time() * 1000)
    hld["count"] = len(hld["funds"])
    hld["source"] = "宏利官网基金详情（季度） + 友邦 FPR 月刊（月末）"
    with open(p, "w", encoding="utf-8") as f:
        json.dump(hld, f, ensure_ascii=False, separators=(",", ":"))
    perf["updatedAt"] = int(time.time() * 1000)
    perf["count"] = len(perf["funds"])
    psrc = perf.get("source") or ""
    if "宏利" in psrc and "友邦" not in psrc:
        perf["source"] = psrc + " + 友邦 FPR"
    with open(pp, "w", encoding="utf-8") as f:
        json.dump(perf, f, ensure_ascii=False, separators=(",", ":"))
    print("\n持仓合并完成：友邦 %d 只写入（holdings 共 %d）· 官方回报 %d 只（trustee-perf 共 %d）" % (ok, hld["count"], ok_p, perf["count"]))


if __name__ == "__main__":
    if "--holdings" in sys.argv:
        merge_holdings()
    else:
        main()
