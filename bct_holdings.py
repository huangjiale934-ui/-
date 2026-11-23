# -*- coding: utf-8 -*-
"""BCT 持仓解析 v2（bct_holdings.py）—— 銀聯信託 6 計劃 Fact Sheet（坐標法）
================================================================================
① 每計劃調 fundInformation 取最新行（filenameOfFactSheet + 基金名/代碼）
② 去重下載 Fact Sheet PDF（tmp/bct_pdf/）
③ 逐頁坐標解析：頁首=基金名；「Asset Allocation* (%)」與「Top Ten Holdings (%)」
   兩欄以 x 分界；Top Ten 行=英文名+%（中文名在相鄰行）；Asset 行=中標籤+右側%
④ 名稱歸一匹配 → 寫入 data/holdings.json
被 BCT 封鎖（SSL 斷開）時 exit 2。
"""
import json
import os
import re
import sys
import time

import pdfplumber
from curl_cffi import requests as cffi

BASE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.join(BASE, "data")
HOLD = os.path.join(DATA, "holdings.json")
PDF_DIR = os.path.join(BASE, "tmp", "bct_pdf")

UA = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"}

SCHEMES = {
    "pro-choice": "BCT積金之選",
    "series-800": "BCT強積金計劃800系列",
    "strategic-mpf": "BCT強積金策略計劃",
    "smart-plan": "BCT強積金—明智之選",
    "industry-choice": "BCT（強積金）行業計劃",
    "simple-plan": "BCT強積金—易富之選",
}

s = cffi.Session(impersonate="chrome")


def norm(s):
    s = str(s or "")
    for ch in "（）()【】[]-–—－·,，.。":
        s = s.replace(ch, "")
    s = re.sub(r"\s+", "", s)
    s = s.replace("類單位", "").replace("單位類別", "").replace("單位", "")
    return s


def fetch_day(sid, date_str, retries=3):
    for a in range(retries):
        try:
            r = s.get("https://www.bcthk.com/bin/servlet/fundInformation",
                      params={"lang": "zh", "schemaInfoId": sid, "date": date_str},
                      headers=UA, impersonate="chrome", timeout=45)
            return (r.json().get("data") or {}).get("fundInformationList") or []
        except Exception as e:
            msg = str(e)
            if "SSL" in msg or "connect" in msg.lower():
                print("[BLOCKED]", sid, flush=True)
                sys.exit(2)
            time.sleep(2 + a * 3)
    return []


def download(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 5000:
        return True
    for a in range(3):
        try:
            r = s.get(url, headers=UA, timeout=180)
            if r.status_code == 200 and r.content[:4] == b"%PDF":
                open(dest, "wb").write(r.content)
                return True
            print("  [!] PDF %s → %s" % (url[-44:], r.status_code), flush=True)
            return False
        except Exception as e:
            if "SSL" in str(e) or "connect" in str(e).lower():
                print("[BLOCKED] PDF 下載被斷開", flush=True)
                sys.exit(2)
            time.sleep(3 + a * 3)
    return False


def parse_page(pg, known_names):
    """坐標解析一頁 → {fund_name, top10, alloc} 或 None（v2：EN行與中文名按序配對）"""
    words = pg.extract_words()
    if not words:
        return None
    al_hdr = None
    top_hdr = None
    for w in words:
        if al_hdr is None and w["text"].startswith("Asset"):
            al_hdr = w
        if top_hdr is None and w["text"] == "Top":
            top_hdr = w
    if al_hdr is None or top_hdr is None:
        return None
    if not (0 < top_hdr["x0"] - al_hdr["x0"] < 400):
        return None
    al_x0 = round(al_hdr["x0"]) - 70
    top_x = round(top_hdr["x0"]) - 8
    hdr_top = round(top_hdr["top"])

    txt = pg.extract_text() or ""
    fname = None
    ntxt = norm(txt)
    for ln in txt.split("\n")[:8]:
        lnn = norm(ln)
        if not lnn:
            continue
        for kn in known_names:
            if kn and len(kn) >= 6 and kn in lnn:
                fname = kn
                break
        if fname:
            break
    if not fname:
        # 页头 CN 行 core 匹配（2026-10-18：fact sheet 页头名与平台名有品牌词差异）
        def corez(z):
            return re.sub(r"(?i)bct|mpf|strategic|smart|simple|industry|series|800|pro|mts", "", z)
        for ln in txt.split("\n")[:6]:
            cjk = "".join(c for c in ln if "\u4e00" <= c <= "\u9fff")
            if len(cjk) < 4 or "計劃" in cjk:
                continue
            cz = corez(cjk)
            if len(cz) < 4:
                continue
            for kn in known_names:
                kz = corez(kn)
                if kz and len(kz) >= 4 and (kz in cz or cz in kz):
                    fname = kn
                    break
            if fname:
                break
    if not fname:
        return None

    def rows_in(x_from, x_to):
        rows = {}
        for w in words:
            if hdr_top + 4 <= w["top"] <= hdr_top + 330 and x_from <= w["x0"] < x_to:
                rows.setdefault(round(w["top"] / 3.2), []).append((round(w["x0"]), w["text"]))
        out = []
        for k, v in sorted(rows.items()):
            nc = "".join(t for _, t in v)          # 無空格拼接（復原被拆的數字/標籤）
            out.append((nc, " ".join(t for _, t in v)))
        return out

    def num_tail(nc):
        m = re.search(r"(\d+(?:\.\d+)?)$", nc)
        return float(m.group(1)) if m else None

    # ── Top Ten（右欄 x≥top_x）：EN+% 行與中文名行按序配對 ──
    en_rows, cn_rows = [], []
    for nc, sp in rows_in(top_x, 9999):
        if "Top" in nc or "投資" in nc:
            continue
        v = num_tail(nc)
        cjk = any("\u4e00" <= c <= "\u9fff" for c in nc)
        if v is not None and 0 < v <= 100 and "Cash" not in nc and "現金" not in nc:
            en = re.sub(r"[\d.]+$", "", nc).strip()
            en = re.sub(r"[^A-Za-z& ]", "", sp[: sp.rfind(" ") if " " in sp else len(sp)]).strip() or en
            en_rows.append((en, v))
        elif cjk and len(nc) <= 14:
            cn_rows.append(nc)
    top10 = []
    for i, (en, v) in enumerate(en_rows):
        cn = cn_rows[i] if i < len(cn_rows) else ""
        nm = (cn + " " + en).strip() if cn else en
        top10.append({"name": nm, "weight": v})
    top10 = top10[:10]

    # ── Asset（左欄）：中文標籤 + 行尾數字 ──
    CN_LABELS = ["基本原料", "非必要消費品", "主要消費品", "能源", "金融", "健康護理", "工業",
                 "物料", "房地產", "科技", "電訊", "公用事業", "現金及其他", "綜合企業",
                 "通訊服務", "防禦性", "週期性", "政府債券", "投資級別", "股票", "債券", "現金",
                 "優先股", "換股債券"]
    alloc = []
    used = set()
    for nc, sp in rows_in(al_x0, top_x):
        cjk = "".join(c for c in nc if "\u4e00" <= c <= "\u9fff")
        lab = None
        for L in CN_LABELS:
            if L in cjk or cjk in L:
                lab = L
                break
        if not lab or lab in used:
            continue
        m = re.search(r"(\d+(?:\.\d+)?)$", nc)
        if not m:
            continue
        v = float(m.group(1))
        if 0 < v <= 100:
            alloc.append({"label": lab, "weight": v})
            used.add(lab)
    if not top10 or len(top10) < 5:
        return None
    return {"fund_name": fname, "top10": top10, "alloc": alloc}


def main():
    os.makedirs(PDF_DIR, exist_ok=True)
    today = time.strftime("%Y-%m-%d")
    plan_rows = {}
    print("① 各計劃基金行…", flush=True)
    for sid, scheme in SCHEMES.items():
        rows = fetch_day(sid, today)
        if rows:
            plan_rows[sid] = rows
            print("  %s：%d 只" % (scheme, len(rows)), flush=True)
        time.sleep(1)
    if not plan_rows:
        print("[FATAL] 全部拉取失敗", flush=True)
        sys.exit(2)

    pdfs = {}
    known = {}
    for sid, rows in plan_rows.items():
        for row in rows:
            fn = row.get("filenameOfFactSheet") or ""
            nm = norm(row.get("name") or "")
            if nm:
                known.setdefault(sid, []).append(nm)
            if not fn:
                continue
            url = "https://www.bcthk.com" + fn if fn.startswith("/") else fn
            pdfs.setdefault(url, {"plans": [sid], "names": [nm]})
    print("② Fact Sheet PDF：%d 個" % len(pdfs), flush=True)

    all_pages = []   # (fund_name_norm, top10, alloc)
    for url, ent in pdfs.items():
        dest = os.path.join(PDF_DIR, re.sub(r"[^A-Za-z0-9_.-]", "_", url.split("/")[-1]))
        print("  下載 %s …" % url.split("/")[-1][:46], flush=True)
        if not download(url, dest):
            continue
        knames = []
        for sid in ent["plans"]:
            knames.extend(known.get(sid, []))
        print("    解析 %s（%d 頁，%d 候選基金名）…" % (dest.split("\\")[-1][:40], 0, len(set(knames))), flush=True)
        try:
            with pdfplumber.open(dest) as pdf:
                n_pages = len(pdf.pages)
                for pi, pg in enumerate(pdf.pages):
                    try:
                        r = parse_page(pg, set(knames))
                    except Exception as e:
                        print("    [!] 頁 %d 解析異常 %s" % (pi, str(e)[:50]), flush=True)
                        continue
                    if r:
                        all_pages.append(r)
                        print("    頁 %d → %s（top10 %d / alloc %d）" % (pi, r["fund_name"][:22], len(r["top10"]), len(r["alloc"])), flush=True)
        except Exception as e:
            print("  [!] PDF 打開失敗", str(e)[:60], flush=True)
        print("    小計：%d 個基金分節" % len(all_pages), flush=True)

    # 匹配写入（经 funds.json：fid → 名称；holdings 条目无 scheme 字段）
    FN = json.load(open(os.path.join(DATA, "funds.json"), encoding="utf-8"))["funds"]
    fmap = {str(x["id"]): x for x in FN}
    hld = json.load(open(HOLD, encoding="utf-8"))
    funds = hld.get("funds") or {}     # 2026-10-18：BCT 基金此前无条目 → 需创建
    hit = miss = 0
    bynm = {}
    for r in all_pages:
        bynm.setdefault(r["fund_name"], r)
    for fid, x in fmap.items():
        if x.get("scheme") not in SCHEMES.values():
            continue
        key = norm(x.get("fundBase") or x.get("fund"))
        def core(z):
            return re.sub(r"(?i)bct|pro|strategic|smart|simple|industry|series|800|mts|mpf", "", z)
        d = bynm.get(key) or bynm.get(core(key))
        if not d:
            kc = core(key)
            if kc and len(kc) >= 4:
                for k, v in bynm.items():
                    kc2 = core(k)
                    if kc2 and len(kc2) >= 4 and (kc2 in kc or kc in kc2):
                        d = v
                        break
        if not d:
            miss += 1
            continue
        old_ent = json.loads(json.dumps(funds.get(str(fid)) or {}))
        ent = funds.setdefault(str(fid), {})
        if d.get("top10"):
            ent["top10"] = [{"name": t["name"], "weight": t["weight"]} for t in d["top10"][:10]]
        if d.get("alloc"):
            ent["alloc"] = [{"label": t["label"], "weight": t["weight"]} for t in d["alloc"]]
        ent["src"] = "BCT 官網 Fact Sheet（季度）"
        ent["asOf"] = ent.get("asOf") or "2026-09-30"
        # 2026-10-26：写盘前质量闸门（旧的好、新的坏 → 保留旧数据）
        sys.path.insert(0, os.path.join(BASE, "tools"))
        try:
            from holdings_filter import errors as _errs, is_degraded as _degraded
            if _degraded(old_ent, ent):
                print("  ⚠ #%s 解析结果不合规（%s），保留旧数据" % (fid, "/".join(_errs(ent))), flush=True)
                funds[str(fid)] = old_ent
                hit -= 1
                miss += 1
                continue
        except Exception as _e:
            print("  ! 质量闸门异常（已放行）：%s" % _e, flush=True)
        hit += 1
    hld["funds"] = funds
    hld["count"] = len(funds)
    hld["updatedAt"] = int(time.time() * 1000)
    json.dump(hld, open(HOLD, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
    print("③ 寫入：命中 %d / 未匹配 %d" % (hit, miss), flush=True)


if __name__ == "__main__":
    main()
