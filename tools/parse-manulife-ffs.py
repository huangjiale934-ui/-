# -*- coding: utf-8 -*-
"""宏利 便覽解析（tools/parse-manulife-ffs.py）
====================================================================
PDF: https://www.mpfa.org.hk/assets/FF/MT00482.pdf
     宏利環球精選(強積金)計劃「季度基金概覽」，**As at March 31, 2026**（宏利财政年度 3-31，
     这一期就是其最新公布，不是我们漏抓）。

版式：一页上下两只基金；保守基金在 p15 上半（下半是穩健基金）。
  「十大資產 / Top 10 Portfolio Holdings」：`1. Hong Kong Government Bond 0% 22/04/2026 3.50%`
    名称里含票息「0%」「2.67%」，权重是**该行最后一个百分比**。
  「投資組合分布 Portfolio Allocation」是柱状图，仅图例有文字：
    港元債券 HKD Bonds 89.5% / 現金及存款 Cash & Deposits 10.5%（合计 100.0）

用法：python tools/parse-manulife-ffs.py tmp/ff_mf.pdf --write
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
SRC = '宏利「季度基金概覽」PDF（季度，經積金局匯總）'
TARGET = {'366': ('宏利MPF 保守基金', 15, (20, 500))}
ALLOC = [('港元債券', 89.5), ('現金及存款', 10.5)]   # 图例读数，合计 100.0
PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')


def parse_top(page, y0, y1):
    """序号行可能单独落在名称行的下一行（`1.` 在 y 更大处），故先按 y 排序、
    丢弃纯序号行，再取含权重的行；权重取该行最后一个百分比（名称里含票息 0%/2.67%）。"""
    b = {}
    for w in page.get_text('words'):
        if not (y0 <= w[1] < y1) or w[0] < 355:
            continue
        b.setdefault(round(w[1] / 2.0), []).append((w[0], w[4]))
    out = []
    for k in sorted(b):
        toks = [t for _, t in sorted(b[k])]
        line = ' '.join(toks).strip()
        if not line or re.fullmatch(r'\d{1,2}\.?', line):
            continue
        pcts = [t for t in toks if PCT.match(t)]
        if not pcts:
            continue
        name = re.sub(r'^\d{1,2}\.\s*', '', line)
        # 只删掉末尾的权重，保留名称里的票息与到期日（如 0% 22/04/2026）
        name = re.sub(r'\s*-?\d+(?:\.\d+)?%\s*$', '', name).strip()
        if name and len(name) >= 4:
            out.append({'name': name[:80], 'weight': float(pcts[-1][:-1])})
        if len(out) >= 10:
            break
    return out


def main():
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(BASE, 'tmp', 'ff_mf.pdf')
    write = '--write' in sys.argv
    doc = pymupdf.open(path)
    h = json.load(open(HOLD, encoding='utf-8')) if write else None
    n = 0
    for fid, (name, pg, (y0, y1)) in TARGET.items():
        page = doc[pg - 1]
        t = page.get_text()
        m = re.search(r'As at\s*([A-Za-z]+)\s*(\d{1,2}),?\s*(\d{4})', t)
        asof = None
        if m:
            mon = {v: i for i, v in enumerate(
                'January February March April May June July August September October November December'.split(), 1)}
            asof = '%s-%02d-%02d' % (m.group(3), mon.get(m.group(1), 0), int(m.group(2)))
        top = parse_top(page, y0, y1)
        alloc = [{'label': k, 'weight': v} for k, v in ALLOC]
        s = round(sum(a['weight'] for a in alloc), 2)
        print('%s p%d %s asOf=%s top=%d 分佈=%d 合计=%.2f' % (fid, pg, name, asof, len(top), len(alloc), s))
        for x in top:
            print('    · %-56s %5.2f' % (x['name'][:56], x['weight']))
        if not write:
            continue
        if not asof or len(top) != 10:
            print('  ✗ 数据不完整，跳过')
            continue
        rec = h['funds'].setdefault(fid, {})
        rec['asOf'] = asof
        rec['top10'] = top
        rec['alloc'] = alloc
        rec['allocSum'] = s
        rec['allocIncomplete'] = False
        rec['src'] = SRC
        n += 1
    if write:
        json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
        print('已写回 %d 条' % n)


if __name__ == '__main__':
    main()
