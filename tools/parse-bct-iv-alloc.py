# -*- coding: utf-8 -*-
"""BCT 策略計劃便覽 · 修正資產分佈標籤錯位（tools/parse-bct-iv-alloc.py）
====================================================================
背景：IV_Fact_Sheet.pdf 每頁一隻基金，資產分佈是「標籤行 / 數值行」交替。
旧解析器把塊標題行也當成一條標籤，導致**標籤整體錯位一格**（權重值本身是對的），
例：恒指基金第 2 條被寫成「金融 5.1」，源檔其實是「能源 Energy 5.1」。

本腳本只按源檔重寫 alloc，top10 不動（已逐條核對一致）。

用法：python tools/parse-bct-iv-alloc.py [--write]
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
PDF = os.path.join(BASE, 'tmp', 'bct_iv.pdf')

# 便览里的基金名 → holdings 记录 id（A/H 两个单位类别共用同一组合）
MAP = {
    '景順中港股票基金': ['195', '196'],
    '景順恒指基金': ['1339', '1340'],
    '景順環球追蹤指數基金': ['2066', '2067'],
    '景順美國追蹤指數基金': ['2068', '2069'],
}
NUM = re.compile(r'^-?\d+(?:\.\d+)?$')


def zh_label(s):
    s = s.replace('*', '').replace('^', '').replace('<', '').strip()
    m = re.findall(r'[\u4e00-\u9fff（）()、／/·\-0-9]+', s)
    return max(m, key=len).strip() if m else s


def parse_page(t):
    # 注意：脚注里也会出现「資產分佈總和可因小數進位…」，必须锁定真正的区块标题
    m1 = re.search(r'資產分佈\s*Asset Allocation', t)
    m2 = re.search(r'持有量最多[^\n]{0,24}Top Ten', t)
    if not m1 or not m2 or m2.start() < m1.start():
        return []
    i, j = m1.start(), m2.start()
    lines = [l.strip() for l in t[i:j].split('\n') if l.strip()]
    out = []
    k = 1 if re.search(r'%\)', lines[0] or '') else 0   # 跳過塊標題
    while k < len(lines):
        if NUM.match(lines[k]):
            k += 1
            continue
        label = lines[k]
        if k + 1 < len(lines) and NUM.match(lines[k + 1]):
            out.append({'label': zh_label(label), 'weight': float(lines[k + 1])})
            k += 2
        else:
            k += 1
    return out


def main():
    write = '--write' in sys.argv
    doc = pymupdf.open(PDF)
    pages = {}
    for pi in range(doc.page_count):
        t = doc[pi].get_text()
        for name in MAP:
            if name in t and '資產分佈' in t and '持有量最多' in t:
                pages.setdefault(name, parse_page(t))

    h = json.load(open(HOLD, encoding='utf-8'))
    n = 0
    for name, ids in MAP.items():
        alloc = pages.get(name) or []
        if not alloc:
            print('✗ %s 未解析到' % name)
            continue
        s = round(sum(a['weight'] for a in alloc), 2)
        print('%s  共 %d 条  合计 %.2f' % (name, len(alloc), s))
        for a in alloc:
            print('    %-14s %6.2f' % (a['label'], a['weight']))
        if write:
            for fid in ids:
                rec = h['funds'].setdefault(fid, {})
                rec['alloc'] = alloc
                rec['allocSum'] = s
                rec['allocIncomplete'] = abs(s - 100) > 0.5
                n += 1
    if write:
        json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\n已写回 %d 条' % n)


if __name__ == '__main__':
    main()
