# -*- coding: utf-8 -*-
"""友邦 基金表現回顧 解析（tools/parse-aia-review.py）
====================================================================
官方原件：https://www.aia.com.hk/content/dam/hk-wise/pdf/form-library/form-and-guides/
          employer/forms/aia-mpf-prime-value-choice-fund-performance-review-<mon>-<yyyy>.pdf.coredownload.inline.pdf
          （月度，文件名里的月份即报告期，如 jul-2026 → 截至 2026-07-31）

版式：每只基金一页；「十大投資項目# | TOP TEN HOLDINGS#」区块为
      名称行（含票息与到期日）/ 百分比行 交替；资产分佈在图例里（如「100.00% 現金及其他」）。

用法：python tools/parse-aia-review.py tmp/aia_jul2026.pdf --write
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
SRC = '友邦官網「基金表現回顧」PDF（月度，aia.com.hk 原件）'
PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')
TARGET = {'強積金保守基金': ('134', 15), '美洲基金': ('878', 9)}


def main():
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(BASE, 'tmp', 'aia_jul2026.pdf')
    write = '--write' in sys.argv
    doc = pymupdf.open(path)
    h = json.load(open(HOLD, encoding='utf-8')) if write else None
    n = 0
    for name, (fid, pg) in TARGET.items():
        t = doc[pg - 1].get_text()
        if name not in t:
            print('✗ p%d 未见 %s' % (pg, name))
            continue
        m = re.search(r'截至\s*(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日', t)
        asof = '%s-%02d-%02d' % (m.group(1), int(m.group(2)), int(m.group(3))) if m else None

        top = []
        i = t.find('TOP TEN HOLDINGS')
        if i >= 0:
            lines = [l.strip() for l in t[i:].split('\n') if l.strip()]
            k = 0
            while k < len(lines) - 1 and len(top) < 10:
                if PCT.match(lines[k + 1]) and not PCT.match(lines[k]):
                    top.append({'name': lines[k][:80], 'weight': float(lines[k + 1][:-1])})
                    k += 2
                else:
                    k += 1

        # 资产分佈：图例「100.00% 現金及其他 Cash and Others」
        alloc = []
        mm = re.search(r'(\d{1,3}(?:\.\d+)?)%\s*([\u4e00-\u9fff][^\n]{0,20})', t)
        if mm and ('現金' in mm.group(2) or '存款' in mm.group(2)):
            alloc = [{'label': '現金及其他', 'weight': float(mm.group(1))}]
        if not alloc and '現金及其他' in t:
            # 该页图例是「100.00% 現金及其他 Cash and Others」，文字层被拆碎；按图例录入
            alloc = [{'label': '現金及其他', 'weight': 100.0}]

        s = round(sum(a['weight'] for a in alloc), 2)
        print('%s p%d asOf=%s top=%d 分佈=%d 合计=%.2f' % (name, pg, asof, len(top), len(alloc), s))
        for x in top:
            print('    · %-52s %5.2f' % (x['name'][:52], x['weight']))
        if not write:
            continue
        if not asof or len(top) != 10:
            print('  ✗ 数据不完整，跳过')
            continue
        rec = h['funds'].setdefault(fid, {})
        rec['asOf'] = asof
        rec['top10'] = top
        # 分布：该页分布区是纯图形（仅图例），解析只有「現金及其他」单项；
        # 旧记录分布项数更多时保留旧分布（寧缺勿錯，不退化）
        old_alloc = rec.get('alloc') or []
        if len(alloc) >= len(old_alloc):
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
