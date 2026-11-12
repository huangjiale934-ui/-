# -*- coding: utf-8 -*-
"""tools/shkp-hket.py —— 新地（SHKP ESS）10 只基金净值兜底
====================================================================
背景（2026-11-12 核查）：
  发行人官网的基金价格 PDF
  https://www.shkp.com/Html/MPF/Fund%20Price%20and%20FFS%20for%20SHKPESS.pdf
  带「编码空格 %20」，被官网 WAF 一律返回 HTTP 999 —— 已用对照实验证明不是文件被撤：
  给任何已知存在的 PDF 末尾加 %20 也同样 999（不加则 200）。
  该 PDF 是月更（内含上月逐日价格），一旦拿不到就整月断档，10 只基金停在 09-30。

数据源：
  发行人 PDF 内文指定的官方每日渠道（原文：「Click the link below to check latest
  constituent fund prices → https://invest.hket.com/fundmpf/daily/MPF_shkp.html」）
  经济通（HKET）该页每日更新 10 只基金的资产净值 + 更新日期，仅当天快照、不支持按日期回查。

口径与限制：
  · 只在「日期 > 该基金历史末点」时追加，不回改历史；
  · HKET 只给当天，所以 2026-10 的缺口补不回来（PDF 恢复后由 fetch-shkp-hist.py 补）；
  · 追加后 navperf 的 d1 会因末尾间隔 >40 天自动置 null（navperf 已有护栏），不会把
    六周涨幅冒充「日涨跌」。

用法：python tools/shkp-hket.py [--dry]
"""
import json
import os
import re
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE)
import histidx  # noqa: E402

URL = "https://invest.hket.com/fundmpf/daily/MPF_shkp.html"
DATA = os.path.join(BASE, "data")
HIST = os.path.join(DATA, "hist")
FUNDS = os.path.join(DATA, "funds.json")
INDEX = os.path.join(DATA, "hist-index.json")
SRC = "經濟通（HKET）強積金每日價格（新地計劃官方指定渠道）"

UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0 Safari/537.36"


def fetch_html():
    """直连优先；不通再走本机代理（HKET 在部分网络需代理）。返回 HTML 文本。"""
    import urllib.request

    def get(via_proxy):
        req = urllib.request.Request(URL, headers={"User-Agent": UA, "Referer": "https://www.shkp.com/"})
        if via_proxy:
            op = urllib.request.build_opener(
                urllib.request.ProxyHandler({"http": via_proxy, "https": via_proxy})
            )
            r = op.open(req, timeout=45)
        else:
            r = urllib.request.urlopen(req, timeout=45)
        return r.read().decode("utf-8", "replace")

    try:
        return get(None)
    except Exception as e:  # noqa: BLE001
        last = e
    for prox in (os.environ.get("HTTPS_PROXY"), os.environ.get("https_proxy"), "http://127.0.0.1:7877"):
        if not prox:
            continue
        try:
            return get(prox)
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError("HKET 页面不可达：%s" % last)


def strip(s):
    return re.sub(r"[\s\u3000]+", "", s or "")


def norm(s):
    """基金名归一：去掉标点/空格/破折号，繁体保持原样。"""
    return re.sub(r"[\s\-–—·,，.。（）()「」/]", "", s or "")


def parse(html):
    """从表格里取出 [(name, nav, isoDate)]。"""
    # 模板里每行：名称 → 资产净值 → 更新日期(dd/mm/yy)
    rows = re.findall(
        r"<tr[^>]*>([\s\S]{0,600}?)</tr>", html, flags=re.I
    ) or re.findall(r"<li[^>]*>([\s\S]{0,600}?)</li>", html, flags=re.I)
    out = []
    for cell in rows:
        text = re.sub(r"<[^>]+>", "\n", cell)
        parts = [p.strip() for p in text.split("\n") if p.strip()]
        name = None
        nav = None
        date = None
        for p in parts:
            m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{2})", p)
            if m:
                date = "20%s-%02d-%02d" % (m.group(3), int(m.group(2)), int(m.group(1)))
                continue
            m = re.fullmatch(r"([\d]{1,6}(?:\.\d{1,6})?)", p.replace(",", ""))
            if m and nav is None and re.search(r"\.", p):
                nav = float(m.group(1))
                continue
            if name is None and re.search(r"[\u4e00-\u9fff]", p) and not re.search(r"日期|基金名", p):
                name = p
        if name and nav and date:
            out.append((name, nav, date))
    return out


def main():
    dry = "--dry" in sys.argv
    funds = json.load(open(FUNDS, encoding="utf-8"))["funds"]
    targets = [f for f in funds if "新地" in (f.get("scheme") or "") and "渣打" in (f.get("trustee") or "")]
    if not targets:
        print("!! 未找到新地计划基金")
        return 2
    by_name = {norm(f["fund"]): f for f in targets}

    html = fetch_html()
    rows = parse(html)
    print("HKET 页面解析到 %d 行" % len(rows))
    if not rows:
        print("!! 未解析到数据行，页面结构可能变了")
        return 2

    added = 0
    skipped = 0
    unknown = []
    idx_updates = {}
    for name, nav, date in rows:
        key = norm(name)
        # HKET 用「——新地」后缀，我方用「 - 新地」
        cand = by_name.get(key)
        if not cand:
            for k, f in by_name.items():
                if key.startswith(k) or k.startswith(key):
                    cand = f
                    break
        if not cand:
            unknown.append(name)
            continue
        fid = str(cand["id"])
        path = os.path.join(HIST, fid + ".json")
        hist = json.load(open(path, encoding="utf-8"))
        series = hist.get("series") or []
        last = series[-1][0] if series else ""
        if date <= last:
            skipped += 1
            continue
        if not dry:
            series.append([date, nav])
            series.sort(key=lambda r: r[0])
            hist["series"] = series
            hist["asOf"] = series[-1][0]
            hist["last"] = series[-1][1]
            hist["points"] = len(series)
            hist["src"] = SRC
            tmp = path + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(hist, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, path)
            idx_updates[fid] = {
                "code": cand.get("code") or cand.get("cfid") or "",
                "src": "shkp-hket",
                "name": cand["fund"],
                "unit": cand.get("unit") or "",
                "scheme": cand.get("scheme") or "",
                "asOf": series[-1][0],
                "last": series[-1][1],
                "first": series[0][0],
                "points": len(series),
            }
        print("  + %s %-28s %s %s" % (fid, cand["fund"][:26], date, nav))
        added += 1

    if idx_updates and not dry:
        histidx.merge_save(INDEX, idx_updates)
        # 基金表同步（nav/navAsOf 必须与历史末点一致，否则 nav-consistency 会报不一致）
        fj = json.load(open(FUNDS, encoding="utf-8"))
        changed = 0
        for f in fj.get("funds", []):
            u = idx_updates.get(str(f.get("id")))
            if not u:
                continue
            f["nav"] = u["last"]
            f["navAsOf"] = u["asOf"]
            f["navSource"] = SRC
            f["navSourceUrl"] = URL
            f["navStatus"] = "verified"
            f.pop("navProvisional", None)
            changed += 1
        if changed:
            fj["updatedAt"] = int(__import__("time").time() * 1000)
            tmp = FUNDS + ".tmp"
            with open(tmp, "w", encoding="utf-8") as fh:
                json.dump(fj, fh, ensure_ascii=False, separators=(",", ":"))
            os.replace(tmp, FUNDS)
            print("基金表已同步 %d 条（nav/navAsOf/navSource）" % changed)

    print("写入 %d 只，跳过（无新日期）%d 只%s" % (added, skipped, "，未匹配：" + "、".join(unknown) if unknown else ""))
    return 0 if added or skipped else 2


if __name__ == "__main__":
    sys.exit(main())
