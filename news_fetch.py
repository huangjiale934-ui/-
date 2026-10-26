# -*- coding: utf-8 -*-
"""積金局新聞稿抓取 → data/news.json

2026-10-20：改用官網 article-listing 的 JSON 接口（POST），可一次取 10 條以上，
不再受列表頁「每頁 5 條」限制，也不再需要 Chrome 渲染。
失敗時保留上一次的 news.json（不覆蓋為空）。
"""
import json
import os
import re
import time
import urllib.request

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "data", "news.json")
API = "https://www.mpfa.org.hk/api/feature/pressrelease/data"
LIST_URL = "https://www.mpfa.org.hk/tc/info-centre/press-releases"
DATA_SOURCE_ID = "{FDB292CA-7C79-43B7-A40B-D546423BBF74}"
WANT = 20          # 2026-10-20：抓 20 條，前端展示 18 條（填滿右欄，多抓 2 條做冗餘）


def fetch(page_size=WANT):
    body = json.dumps({
        "year": None,
        "currentPage": 0,
        "pageSize": page_size,
        "currentLanguage": "zh-TW",
        "dataSourceId": DATA_SOURCE_ID,
    }).encode("utf-8")
    req = urllib.request.Request(API, data=body, method="POST", headers={
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36",
        "Referer": LIST_URL,
        "Accept": "application/json, text/plain, */*",
    })
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read().decode("utf-8"))


def strip_tags(s):
    s = re.sub(r"<[^>]+>", "", s or "")
    s = s.replace("&nbsp;", " ").replace("&amp;", "&").replace("&quot;", '"')
    s = s.replace("&#39;", "'").replace("&lt;", "<").replace("&gt;", ">")
    return re.sub(r"\s+", " ", s).strip()


def to_items(payload):
    out, seen = [], set()
    for x in payload.get("news") or []:
        title = strip_tags(x.get("title"))
        if not title or title in seen:
            continue
        seen.add(title)
        path = x.get("url") or ""
        url = path if path.startswith("http") else "https://www.mpfa.org.hk" + path
        out.append({"date": (x.get("date") or "").strip(), "title": title, "url": url})
    return out


def main():
    items = []
    try:
        items = to_items(fetch())
        print("[news] 接口返回 %d 条" % len(items))
    except Exception as e:
        print("[news] 接口失败：%s" % e)
    if not items:
        print("[news] 未取得条目，保留上次结果")
        return
    data = {
        "updatedAt": int(time.time() * 1000),
        "source": "積金局「新聞稿」",
        "sourceUrl": LIST_URL,
        "items": items[:18],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump(data, open(OUT, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    print("[news] 已写入 %d 条 → data/news.json" % len(data["items"]))
    for x in data["items"][:3]:
        print("   ", x["date"], x["title"][:40])


if __name__ == "__main__":
    main()
