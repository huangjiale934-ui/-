# -*- coding: utf-8 -*-
"""mpfa-monthly-sync.py —— 自動抓取積金局「強積金投資回報臨時數據」月報

背景（2026-11-11）：data/mpfa-monthly.json 一直是人工核對新聞稿後錄入，
官方每月 6 日前後發佈，人工容易漏（實測停在 2026-09-30）。

官方表格是**圖片**（…/press-releases/YYYYMMDD/1_sc.png），所以用 OCR 解析：
  1) 探測最近 12 天的新聞稿網址，找標題含「投資回報」「臨時數據」的那篇；
  2) 下載簡體版表格圖片（Windows/ONNX 的 OCR 對簡體最準）；
  3) 按 x/y 座標還原 9 行 ×（占比 / 2000 起 / 2017 起 / 過去12個月）四組數字；
  4) 三重校驗：占比合計≈100、最低≤平均≤最高、正文敘述裡的 5.1/4.7/7.1 對得上；
  5) 全部通過才寫檔，任何一項不過就保留舊資料並回報原因（絕不寫半對的數字）。

用法：
  python tools/mpfa-monthly-sync.py --dry      # 只印解析結果，不寫檔
  python tools/mpfa-monthly-sync.py            # 有新期才寫
  python tools/mpfa-monthly-sync.py --date 20261006   # 指定某一期（回歸測試用）
"""
import argparse
import json
import os
import re
import sys
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", "mpfa-monthly.json")
UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/142.0"}

# 9 行的固定順序（官方原表順序，OCR 只認位置，名稱與 key 用這裡的）
ROWS = [
    ("equity", "股票基金", False),
    ("mixed", "混合資產基金", False),
    ("disCore", "DIS 核心累積基金", True),
    ("dis65", "DIS 65歲後基金", True),
    ("mixedOth", "其他", True),
    ("bond", "債券基金", False),
    ("guar", "保證基金", False),
    ("cons", "強積金保守基金", False),
    ("mmf", "貨幣市場基金（非保守）", False),
]

COL_NAME, COL_SHARE, COL_SINCE, COL_DIS, COL_M12 = 0, 1, 2, 3, 4


def fetch(url, timeout=40):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read()


def fetch_text(url):
    return fetch(url).decode("utf-8", "ignore")


def find_release(today=None, only=None):
    """探測最近 12 天（或指定日期）的新聞稿，回傳 (date, url) 或 (None, None)"""
    import datetime
    if only:
        cands = [only]
    else:
        d0 = today or datetime.date.today()
        # 回溯 20 天：機器若在月初停機幾天，恢復後仍能補上（官方約每月 6 日發佈）
        cands = [(d0 - datetime.timedelta(days=i)).strftime("%Y%m%d") for i in range(0, 20)]
    for d in cands:
        url = "https://www.mpfa.org.hk/tc/info-centre/press-releases/%s" % d
        try:
            html = fetch_text(url)
        except Exception:
            continue
        title = (re.search(r"<title>(.*?)</title>", html, re.S) or [0, ""])[1]
        if "投資回報" in title and "臨時數據" in title:
            return d, url, html
    return None, None, None


def image_url(html, date):
    m = re.search(r'src="([^"]*press-releases/%s/1_sc\.png[^"]*)"' % date, html)
    if m:
        src = m.group(1)
        return src if src.startswith("http") else "https://www.mpfa.org.hk" + src
    # 簡體頁沒有就退回繁體
    m = re.search(r'src="([^"]*press-releases/%s/1_tc\.png[^"]*)"' % date, html)
    if not m:
        return None
    src = m.group(1)
    return src if src.startswith("http") else "https://www.mpfa.org.hk" + src


def ocr_items(png_path):
    from rapidocr_onnxruntime import RapidOCR
    res = RapidOCR()(png_path)[0] or []
    items = []
    for it in res:
        box, txt, conf = it[0], it[1], it[2]
        xs = [p[0] for p in box]
        ys = [p[1] for p in box]
        items.append({
            "x0": min(xs), "x1": max(xs), "y0": min(ys), "y1": max(ys),
            "cx": (min(xs) + max(xs)) / 2, "cy": (min(ys) + max(ys)) / 2,
            "t": str(txt).strip(), "c": float(conf),
        })
    return items


def to_num(t):
    s = str(t).replace("％", "%").replace(" ", "")
    s = s.replace("—", "-").replace("–", "-").replace("−", "-")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    return float(m.group(0)) if m else None


def parse_range(t):
    m = re.search(r"\(\s*(-?\d+(?:\.\d+)?)%?\s*[/／]\s*(-?\d+(?:\.\d+)?)%?\s*\)", t)
    if m:
        return float(m.group(1)), float(m.group(2))
    return None, None


def share_column_pass(png_path, anchors):
    """專門補「佔比」欄：全圖 OCR 常漏掉灰底行的小號 3%／9%，
    把該欄單獨裁出來放大 4 倍再 OCR，命中率高得多。"""
    try:
        from PIL import Image
        from rapidocr_onnxruntime import RapidOCR
    except Exception:
        return [None] * 9
    im = Image.open(png_path).convert("RGB")
    w, h = im.size
    x0, x1 = int(w * 0.30), int(w * 0.44)
    y0, y1 = int(min(anchors)) - 25, int(max(anchors)) + 25
    c = im.crop((x0, max(0, y0), x1, min(h, y1)))
    c = c.resize((c.width * 4, c.height * 4), Image.LANCZOS)
    tmp = png_path + ".share.png"
    c.save(tmp)
    res = RapidOCR()(tmp)[0] or []
    vals = []
    for it in res:
        y = min(p[1] for p in it[0]) / 4 + max(0, y0)
        v = to_num(it[1])
        if v is None:
            continue
        vals.append((y, v, "<" in it[1]))
    out = [None] * 9
    for y, v, lt in vals:
        i = min(range(9), key=lambda k: abs(anchors[k] - y))
        if abs(anchors[i] - y) <= 22 and out[i] is None:
            out[i] = (v, lt)
    return out


def parse_table(items):
    """把 OCR 方塊還原成 9 行 4 組數字

    錨點用「過去 12 個月」那一欄的 9 個平均值（每行恰好一個純數字，
    不受跨行標題「自預設投資策略…」干擾；早期用最左側名稱欄做錨點，
    會把表頭「基金種類／佔全部基金」也算成一行，整體錯位）。
    """
    def plain_num(t):
        s = str(t).replace("％", "%").replace(" ", "")
        return re.fullmatch(r"-?\d+(?:\.\d+)?%?", s) is not None

    avgs = [x for x in items if x["cx"] > 950 and x["cy"] > 150 and plain_num(x["t"])]
    avgs.sort(key=lambda x: x["cy"])
    if len(avgs) != 9:
        return None, "「過去12個月」欄只認出 %d 個數值（需 9 個）" % len(avgs), None
    anchors = [a["cy"] for a in avgs]

    buckets = [[] for _ in range(9)]
    for it in items:
        if it["cy"] <= 120:
            continue
        idx = min(range(9), key=lambda i: abs(anchors[i] - it["cy"]))
        if abs(anchors[idx] - it["cy"]) <= 26:
            buckets[idx].append(it)

    table = []
    for i, b in enumerate(buckets):
        row = {"share": None, "since": None, "sinceHi": None, "sinceLo": None,
               "dis": None, "disHi": None, "disLo": None,
               "m12": None, "m12Hi": None, "m12Lo": None}
        for it in b:
            x, t = it["cx"], it["t"]
            if x < 360:
                continue
            if 380 <= x < 500:
                v = to_num(t)
                if v is not None and row["share"] is None:
                    row["share"] = v
                    row["shareLt"] = "<" in t
            elif 540 <= x < 745:
                hi, lo = parse_range(t)
                if hi is not None:
                    row["sinceHi"], row["sinceLo"] = hi, lo
                else:
                    v = to_num(t)
                    if v is not None and "不适用" not in t and "不適用" not in t:
                        row["since"] = v
            elif 745 <= x < 950:
                hi, lo = parse_range(t)
                if hi is not None:
                    row["disHi"], row["disLo"] = hi, lo
                else:
                    v = to_num(t)
                    if v is not None:
                        row["dis"] = v
            elif 950 <= x:
                hi, lo = parse_range(t)
                if hi is not None:
                    row["m12Hi"], row["m12Lo"] = hi, lo
                else:
                    v = to_num(t)
                    if v is not None:
                        row["m12"] = v
        table.append(row)
    return table, "", anchors


def validate(table, html_txt):
    errs = []
    shares = [r.get("share") for r in table]
    if any(s is None for s in shares):
        errs.append("占比缺值：%s" % shares)
    else:
        # 官方原表是「階層式」：混合資產 34% 之下再拆 DIS 核心 9%／65 歲後 3%／其他 22%，
        # 所以只有最上層六類（股票/混合/債券/保證/保守/貨幣）相加才等於 100。
        top = sum(shares[i] for i in (0, 1, 5, 6, 7, 8))
        if not (97 <= top <= 101):
            errs.append("上層六類占比合計 %.1f%% 不在 97–101 之間" % top)
    for i, r in enumerate(table):
        name = ROWS[i][1]
        if r["m12"] is None:
            errs.append("%s 缺過去 12 個月回報" % name)
            continue
        if not (-60 <= r["m12"] <= 60):
            errs.append("%s 過去 12 個月 %.1f%% 超出合理範圍" % (name, r["m12"]))
        for k in ("since", "dis"):
            v = r.get(k)
            if v is not None and not (-20 <= v <= 30):
                errs.append("%s %s %.1f%% 超出合理範圍" % (name, k, v))
        for avg_k, hi_k, lo_k in (("m12", "m12Hi", "m12Lo"), ("since", "sinceHi", "sinceLo"), ("dis", "disHi", "disLo")):
            avg, hi, lo = r.get(avg_k), r.get(hi_k), r.get(lo_k)
            if avg is not None and hi is not None and lo is not None:
                if not (lo - 0.01 <= avg <= hi + 0.01):
                    errs.append("%s %s 平均 %.2f 不在 [%.2f, %.2f] 內" % (ROWS[i][1], avg_k, avg, lo, hi))
    # 正文錨點：股票基金/混合資產基金 自制度實施以來 = 5.1 / 4.7；DIS 核心累積 = 7.1
    m = re.search(r"股票基金和混合資產基金的平均年率化淨回報分別為\s*([\d.]+)%和([\d.]+)%", html_txt)
    if m:
        a, b = float(m.group(1)), float(m.group(2))
        if table[0].get("since") is None or abs(table[0]["since"] - a) > 0.05:
            errs.append("正文錨點不符：股票基金 since %s ≠ %s" % (table[0].get("since"), a))
        if table[1].get("since") is None or abs(table[1]["since"] - b) > 0.05:
            errs.append("正文錨點不符：混合資產 since %s ≠ %s" % (table[1].get("since"), b))
    m2 = re.search(r"核心累積基金，自2017年推出以來的平均年率化淨回報為\s*([\d.]+)%", html_txt)
    if m2:
        c = float(m2.group(1))
        if table[2].get("dis") is None or abs(table[2]["dis"] - c) > 0.05:
            errs.append("正文錨點不符：DIS 核心累積 dis %s ≠ %s" % (table[2].get("dis"), c))
    return errs


def build(table, date, url, asof):
    rows = []
    for i, (key, name, sub) in enumerate(ROWS):
        r = table[i]
        o = {"key": key, "name": name, "sub": sub, "share": r["share"]}
        if r.get("shareLt"):
            o["shareLt"] = True
        o.update({
            "m12": r["m12"], "m12Hi": r["m12Hi"], "m12Lo": r["m12Lo"],
            "since": r["since"], "dis": r["dis"],
        })
        if key == "mixedOth":
            o["note"] = "混合資產基金中非 DIS 部分（官方原表如此）"
        rows.append(o)
    return {
        "publishedAt": "%s-%s-%s" % (date[:4], date[4:6], date[6:]),
        "asOf": asof,
        "source": url,
        "sourceLabel": "積金局新聞稿（%s-%s-%s）" % (date[:4], date[4:6], date[6:]),
        "rows": rows,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    ap.add_argument("--date", default="")
    ap.add_argument("--png", default="")
    a = ap.parse_args()

    old = {}
    try:
        old = json.load(open(OUT, encoding="utf-8"))
    except Exception:
        pass

    date, url, html = find_release(only=a.date or None)
    if not date:
        print("SKIP 最近 20 天沒有新的「投資回報臨時數據」新聞稿（官網尚未發佈）")
        # 2026-11-13（复验报告 E4）：SKIP 不是失败。原返回 2 会被 daily.sh 记成「!!! 失败」，
        # 11-11 与 11-13 两次日志都留了假告警。改成 0，同时在输出里保留 SKIP 字样。
        return 0

    asof_m = re.search(r"截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(?:底|(\d{1,2})\s*日)", html)
    if not asof_m:
        print("FAIL 找不到「截至 YYYY 年 M 月」")
        return 1
    y, mo = int(asof_m.group(1)), int(asof_m.group(2))
    if asof_m.group(3):
        asof = "%04d-%02d-%02d" % (y, mo, int(asof_m.group(3)))
    else:
        import calendar
        asof = "%04d-%02d-%02d" % (y, mo, calendar.monthrange(y, mo)[1])

    if old.get("asOf") and asof <= old["asOf"] and not a.dry:
        print("SKIP 官網最新一期 %s 不新於本地 %s" % (asof, old["asOf"]))
        return 0   # 同上：无新数据不算失败

    png = a.png
    if not png:
        # 優先用簡體版表格圖片（OCR 模型是 zh-Hans，簡體辨識率明顯更高）；
        # 正文校驗仍用繁體頁，因為錨點句子按繁體撰寫。
        iu = None
        try:
            sc_html = fetch_text("https://www.mpfa.org.hk/sc/info-centre/press-releases/%s" % date)
            if "1_sc.png" in sc_html:
                iu = image_url(sc_html, date)
        except Exception:
            pass
        if not iu:
            iu = image_url(html, date)
        if not iu:
            print("FAIL 找不到表格圖片")
            return 1
        png = os.path.join(ROOT, "tmp", "mpfa-monthly-%s.png" % date)
        os.makedirs(os.path.dirname(png), exist_ok=True)
        open(png, "wb").write(fetch(iu))

    table, err, anchors = parse_table(ocr_items(png))
    if table is None:
        print("FAIL " + err)
        return 1
    if any(r.get("share") is None for r in table):
        for i, v in enumerate(share_column_pass(png, anchors)):
            if v and table[i].get("share") is None:
                table[i]["share"], table[i]["shareLt"] = v[0], v[1]
    html_txt = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html))
    errs = validate(table, html_txt)
    if errs:
        print("FAIL 校驗未通過（保留舊資料）：")
        for e in errs:
            print("  - " + e)
        return 1

    out = build(table, date, url, asof)
    print("OK %s 期，資料截至 %s，9 行全部通過校驗" % (out["publishedAt"], asof))
    for r in out["rows"]:
        print("  %-18s 占比 %5s%%  12個月 %6s%%  2000起 %5s  2017起 %5s"
              % (r["name"], r["share"], r["m12"], r["since"], r["dis"]))

    if a.dry:
        print("（--dry：未寫檔）")
        return 0
    tmp = OUT + ".tmp"
    json.dump(out, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, OUT)
    print("已寫入 data/mpfa-monthly.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
