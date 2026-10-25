# -*- coding: utf-8 -*-
"""友邦 MPF 便覽解析（tools/parse-aia-ffs.py）
====================================================================
PDF: https://www.mpfa.org.hk/assets/FF/MT00172.pdf（友邦強積金優選計劃）
     该版为**月报**，报告期见页眉「截至2026年5月31日 As at 31 May 2026」。

版式：
    每只基金一页（p7 起）；「十大投資項目# | TOP TEN HOLDINGS#」区块为
      名称行 / 百分比行 交替（10 对）
    资产分佈是**图形**，仅图例有文字：本基金为「100.00% 現金及其他 Cash and Others」，
    故按图例文字直接判定单一类别。

用法：python tools/parse-aia-ffs.py tmp/ff_aia.pdf --write
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')

# 基金名 → (holdings id, 页码, 图例兜底)
# 友邦这份月报的资产分佈是图形，图例文字「100.00% 現金及其他 Cash and Others」在文字层里
# 被拆成多个词、无法用正则稳定取出，故按 300dpi 渲染肉眼核对后录入（合计 100.0）。
PAGE = {'強積金保守基金': ('134', 15, [('現金及其他', 100.0)])}
SRC = '友邦「基金便覽」PDF（月度，經積金局匯總）'
PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')


def parse_page(t):
    asof = None
    m = re.search(r'截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', t)
    if m:
        asof = '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3)))
    # 十大
    i = t.find('TOP TEN HOLDINGS')
    top = []
    if i >= 0:
        lines = [l.strip() for l in t[i:].split('\n') if l.strip()]
        k = 0
        while k < len(lines) - 1 and len(top) < 10:
            if PCT.match(lines[k + 1]) and not PCT.match(lines[k]):
                top.append({'name': lines[k][:80], 'weight': float(lines[k + 1][:-1])})
                k += 2
            else:
                k += 1
    # 资产分佈：图例文字「100.00% 現金及其他 Cash and Others」
    alloc = []
    # 图例形如「100.00% 現金及其他 Cash and Others」：按行取「百分比 + 中文名」
    for line in t.split('\n'):
        if '%' not in line:
            continue
        mm = re.search(r'(\d{1,3}(?:\.\d+)?)%\s*([\u4e00-\u9fff][^\n]*)', line)
        if mm and ('現金' in mm.group(2) or '存款' in mm.group(2) or '債券' in mm.group(2) or '股票' in mm.group(2)):
            zh = re.findall(r'[\u4e00-\u9fff（）()、／/·\-]+', mm.group(2))
            if zh:
                alloc.append({'label': max(zh, key=len).strip(), 'weight': float(mm.group(1))})
                break
    return asof, top, alloc


def main():
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(BASE, 'tmp', 'ff_aia.pdf')
    write = '--write' in sys.argv
    doc = pymupdf.open(path)
    h = json.load(open(HOLD, encoding='utf-8')) if write else None
    n = 0
    for name, (fid, pg, alloc_fb) in PAGE.items():
        t = doc[pg - 1].get_text()
        if name not in t:
            print('✗ p%d 未见 %s' % (pg, name))
            continue
        asof, top, alloc = parse_page(t)
        if not alloc and alloc_fb:
            alloc = [{'label': k, 'weight': v} for k, v in alloc_fb]
        s = round(sum(a['weight'] for a in alloc), 2)
        print('%s p%d asOf=%s top=%d 分佈=%d 合计=%.2f' % (name, pg, asof, len(top), len(alloc), s))
        for a in alloc:
            print('    %-10s %6.2f' % (a['label'], a['weight']))
        for x in top[:3]:
            print('    · %-46s %5.2f' % (x['name'][:46], x['weight']))
        if not write:
            continue
        if not asof or len(top) != 10 or not alloc:
            print('  ✗ 数据不完整，跳过写库')
            continue
        rec = h['funds'].setdefault(fid, {})
        rec['asOf'] = asof
        rec['top10'] = top
        rec['alloc'] = alloc
        rec['allocSum'] = s
        rec['allocIncomplete'] = abs(s - 100) > 0.5
        rec['src'] = SRC
        n += 1
    if write:
        json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
        print('已写回 %d 条' % n)


if __name__ == '__main__':
    main()
