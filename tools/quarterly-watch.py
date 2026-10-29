#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""季度便览哨兵（2026-10-29，5.0）

目标：汇丰/恒生 Q3、AMTD Q3 一旦发布，自动下载 + 解析写回，并留下复核报告。
用法：
  python tools/quarterly-watch.py                # 直连
  python tools/quarterly-watch.py --proxy=http://127.0.0.1:7877

输出：data/quarterly-report.json（是否更新、下载文件、是否写回、待复核事项）
"""
import json
import os
import re
import subprocess
import sys
from datetime import datetime

import pymupdf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'tmp', 'quarterly')
os.makedirs(OUT, exist_ok=True)
PROXY = ''
for a in sys.argv[1:]:
    if a.startswith('--proxy='):
        PROXY = a.split('=', 1)[1]
PROXY = PROXY or os.environ.get('AMTD_PROXY', '')
UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36'

MONTHS = {'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4, 'may': 5, 'jun': 6,
          'jul': 7, 'aug': 8, 'sep': 9, 'oct': 10, 'nov': 11, 'dec': 12}
QEND = {3: '-03-31', 6: '-06-30', 9: '-09-30', 12: '-12-31'}


def fetch(url, out):
    cmd = ['curl', '-s', '-L', '--max-time', '90', '-A', UA, '-o', out, url]
    if PROXY:
        cmd[1:1] = ['-x', PROXY]
    subprocess.run(cmd, check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if not os.path.exists(out) or os.path.getsize(out) < 20000:
        return False
    with open(out, 'rb') as f:
        return f.read(5) == b'%PDF-'


def text_of(path, pages=1):
    try:
        d = pymupdf.open(path)
        return '\n'.join(d[i].get_text() for i in range(min(pages, d.page_count)))
    except Exception:
        return ''


def period_of(text):
    """返回季度末日期字符串，识别不了返回 ''"""
    m = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4})', text, re.I)
    if m:
        mon = MONTHS[m.group(1).lower()]
        q = ((mon - 1) // 3 + 1) * 3
        return '%d%s' % (int(m.group(2)), QEND[q])
    m = re.search(r'(\d{2})/(\d{2})/(\d{4})', text)
    if m:
        return '%s-%s-%s' % (m.group(3), m.group(2), m.group(1))
    m = re.search(r'(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', text)
    if m:
        return '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    m = re.search(r'(20\d{2})\s*[｜|]?\s*第\s*([一二三四1234])\s*季', text)
    if m:
        q = {'一': 3, '二': 6, '三': 9, '四': 12, '1': 3, '2': 6, '3': 9, '4': 12}[m.group(2)]
        return '%s%s' % (m.group(1), QEND[q])
    return ''


def current_asof(prefixes):
    h = json.load(open(os.path.join(ROOT, 'data', 'holdings.json'), encoding='utf-8'))
    dates = []
    for d in (h.get('funds') or {}).values():
        src = str(d.get('src') or '')
        if any(p in src for p in prefixes) and d.get('asOf'):
            dates.append(d['asOf'])
    return max(dates) if dates else ''


def read_slugs():
    page = os.path.join(OUT, 'amtd.html')
    subprocess.run(['curl', '-s', '-L', '--max-time', '30', '-A', UA, '-o', page,
                    'https://www.ooogroup.xyz/locales/hk/mpf-3'], check=False)
    html = open(page, encoding='utf-8', errors='ignore').read()
    return re.findall(r'files\.ooogroup\.xyz/mpf/fund-facts/([a-z0-9-]+)', html)


def drive_id(slug):
    url = 'https://files.ooogroup.xyz/mpf/fund-facts/' + slug
    cmd = ['curl', '-s', '-o', os.devnull, '-w', '%{redirect_url}', '--max-time', '20', '-A', UA, url]
    loc = subprocess.check_output(cmd, text=True).strip()
    m = re.search(r'/d/([A-Za-z0-9_-]{20,})', loc)
    return m.group(1) if m else ''


def main():
    report = {'generatedAt': datetime.now().isoformat(timespec='seconds'), 'proxy': bool(PROXY), 'groups': []}
    review = []

    # ---- AMTD ----
    cur = current_asof(['AMTD'])
    slugs = read_slugs()
    g = {'name': 'AMTD', 'currentAsOf': cur, 'slugs': len(slugs), 'updated': False}
    if slugs:
        first = slugs[0]
        fid = drive_id(first)
        sample = os.path.join(OUT, 'amtd-sample.pdf')
        if fid and fetch('https://drive.google.com/uc?export=download&confirm=t&id=' + fid, sample):
            latest = period_of(text_of(sample))
            g['latestPeriod'] = latest
            if latest and latest > cur:
                files = []
                for slug in slugs:
                    fid2 = drive_id(slug)
                    out = os.path.join(ROOT, 'tmp', 'amtd', slug + '.pdf')
                    os.makedirs(os.path.dirname(out), exist_ok=True)
                    if fid2 and fetch('https://drive.google.com/uc?export=download&confirm=t&id=' + fid2, out):
                        files.append(out)
                g['downloaded'] = len(files)
                if len(files) == len(slugs):
                    rc = subprocess.run([sys.executable, os.path.join(ROOT, 'tools', 'parse-amtd-ffs.py'), '--write'],
                                        cwd=ROOT).returncode
                    g['updated'] = rc == 0
                    g['action'] = '已下载并写回 holdings.json' if rc == 0 else '已下载，解析失败'
                    review.append('AMTD 新季 %s：16 份已下载%s，请复核十大持仓与分布' % (latest, '并写回' if rc == 0 else '，解析待修'))
            else:
                g['action'] = '官方尚未发布新季'
        else:
            g['action'] = '样张下载失败（网络或代理）'
    else:
        g['action'] = '未解析到 16 个便览链接'
    report['groups'].append(g)

    # ---- 汇丰 / 恒生 ----
    for name, url, src_keys in [
        ('滙豐', 'https://www.hsbc.com.hk/mpf/ffs.pdf', ['滙豐強積金智選計劃']),
        ('恒生', 'https://cms.hangseng.com/cms/pws/files/pdfs/FFS.pdf', ['恒生強積金智選計劃']),
    ]:
        cur2 = current_asof(src_keys)
        out = os.path.join(OUT, name + '.pdf')
        g2 = {'name': name, 'currentAsOf': cur2, 'updated': False}
        if fetch(url, out):
            latest = period_of(text_of(out))
            g2['latestPeriod'] = latest
            if latest and latest > cur2:
                g2['updated'] = True
                g2['action'] = '已下载新季 FFS，待写回'
                review.append('%s 新季 %s：FFS 已下载到 %s，请运行持仓解析并复核' % (name, latest, out))
            else:
                g2['action'] = '官方尚未发布新季'
        else:
            g2['action'] = 'FFS 下载失败'
        report['groups'].append(g2)

    report['review'] = review
    with open(os.path.join(ROOT, 'data', 'quarterly-report.json'), 'w', encoding='utf-8') as f:
        json.dump(report, f, ensure_ascii=False, indent=2)
    for g in report['groups']:
        print('%s | 当前 %s | 官方 %s | %s' % (g['name'], g.get('currentAsOf'), g.get('latestPeriod', '未知'), g.get('action')))
    if review:
        print('待复核：')
        for r in review:
            print(' - ' + r)


if __name__ == '__main__':
    main()
