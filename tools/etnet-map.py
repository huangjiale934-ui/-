# -*- coding: utf-8 -*-
"""etnet / etwealth 基金 id 映射（2026-10-23）
   枚举 fd_id=ETNSI<n>，抓取基金名与资产配置（picChartStr），落盘 tmp/etnet-funds.json
"""
import json, re, sys, os
import urllib.request
from concurrent.futures import ThreadPoolExecutor

REF = 'https://www.etnet.com.hk/www/tc/mpf/fund_detail.php?provider=ETNSI20&plan=ETNSI44&fund=ETNSI574'
BASE = 'https://fc10.etwealth.com/wfc-etnet-hk/mpfDetail.do?method=searchMpfDetail&locale=zh_TW&appId=etnet-hk&fd_id=%s&backUrl='

def fetch(n):
    fid = 'ETNSI%d' % n
    req = urllib.request.Request(BASE % fid, headers={'User-Agent': 'Mozilla/5.0 Chrome/131.0', 'Referer': REF})
    try:
        h = urllib.request.urlopen(req, timeout=20).read().decode('utf-8', 'ignore')
    except Exception:
        return None
    if len(h) < 40000:
        return None
    m = re.search(r'積金報價[\s\S]{0,80}?&nbsp;([^<]{4,80})<', h)
    if not m:
        return None
    name = m.group(1).strip()
    a = re.search(r'picChartStr"[^>]*value="([^"]*)"', h, re.S)
    alloc = a.group(1).strip() if a else ''
    return {'id': fid, 'n': n, 'name': name, 'alloc': alloc}

def main():
    lo, hi = 1, int(sys.argv[1]) if len(sys.argv) > 1 else 1500
    out = {}
    with ThreadPoolExecutor(max_workers=8) as ex:
        for r in ex.map(fetch, range(lo, hi + 1)):
            if r:
                out[r['id']] = r
                print('  +', r['id'], r['name'][:30], flush=True)
    json.dump(out, open('tmp/etnet-funds.json', 'w', encoding='utf-8'), ensure_ascii=False)
    print('共抓到', len(out), '只')

if __name__ == '__main__':
    main()
