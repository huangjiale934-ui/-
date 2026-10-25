# -*- coding: utf-8 -*-
"""etnet 模擬回報（供款）批量抓取 → tmp/etnet-dca.json"""
import json, re
from playwright.sync_api import sync_playwright

def num(s):
    return float(s.replace(',', '').replace('%', '').replace('+', ''))

def parse(txt):
    def grab(label, n=5):
        i = txt.find(label)
        if i < 0: return []
        seg = txt[i + len(label): i + len(label) + 220]
        vals = re.findall(r'-?\d[\d,]*(?:\.\d+)?', seg)
        return vals[:n]
    return {'contrib': grab('累積供款額'), 'fee': grab('估計積金開支'),
            'value': grab('積金總現值'), 'net': grab('供款淨賺/蝕', 10)}

def main():
    picks = json.load(open('tmp/etnet-50.json', encoding='utf-8'))[:20]
    out = []
    with sync_playwright() as p:
        b = p.chromium.launch(channel='chrome', headless=True)
        pg = b.new_page()
        for k, it in enumerate(picks, 1):
            try:
                pg.goto('https://www.etnet.com.hk/www/tc/mpf/fund_detail.php?fund=' + it['etnet'],
                        timeout=25000, wait_until='domcontentloaded')
                pg.wait_for_timeout(700)
                fr = [f for f in pg.frames if 'etwealth' in f.url]
                if not fr:
                    print(k, it['etnet'], 'no-frame', flush=True); continue
                fr[0].click('text=模擬回報')
                pg.wait_for_timeout(1800)
                t = None
                for f in pg.frames:
                    try: x = f.inner_text('body')
                    except Exception: continue
                    if '累積供款額' in x: t = x; break
                if not t:
                    print(k, it['etnet'], 'no-table', flush=True); continue
                r = parse(t)
                r.update({'id': it['id'], 'etnet': it['etnet'], 'fund': it['fund'], 'scheme': it['scheme']})
                out.append(r)
                print(k, it['etnet'], r['value'][:2], r['net'][:4], flush=True)
            except Exception as e:
                print(k, it['etnet'], 'ERR', str(e)[:50], flush=True)
        b.close()
    json.dump(out, open('tmp/etnet-dca.json', 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    print('完成', len(out))

if __name__ == '__main__':
    main()
