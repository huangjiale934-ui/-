# -*- coding: utf-8 -*-
"""信安 800 系列便览 · 投资分布修正（tools/parse-s800-alloc.py）
====================================================================
PDF: https://www.bcthk.com/content/dam/bcthk-sites/pdf/S800_FFS_2026Q2.pdf
     （截至 30/6/2026；每页一只基金）

坑：这个版本的区块标题是「投資分布 Asset Allocation Breakdown」，
    不是「資產分佈」，所以旧解析器根本没命中，标签只能从别处凑，
    结果「H股 / A股」被截成「股」（单字母前缀被当成英文丢掉）。

版式：
    投資分布 Asset Allocation Breakdown8,9 (%)
    1
    2
    ...
    5 6 7            ← 图例编号行，需跳过
    1
    民企股 P Chips
    42.0
    2
    H股 H Shares
    22.2
    ...
    十大投資 Top Ten Holdings8 (%)   ← 到此处结束

用法：python tools/parse-s800-alloc.py [--write]
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
PDF = os.path.join(BASE, 'tmp', 'bct_s800.pdf')

MAP = {
    '信安中國股票基金': ['619', '620'],
    '信安香港股票基金': ['428', '429'],
}


def label_of(raw):
    """「H股 H Shares」→ H股；「香港股票 Hong Kong Equities」→ 香港股票"""
    s = raw.strip().replace('　', ' ')
    parts = s.split()
    if not parts:
        return s
    first = parts[0]
    if re.search(r'[\u4e00-\u9fff]', first):
        return first
    return s


def parse_page(t):
    m1 = re.search(r'投資分布\s*Asset Allocation', t)
    m2 = re.search(r'十大投資\s*Top Ten', t)
    if not m1 or not m2:
        return None, []
    # 本版式的顺序是「十大投資」在前、「投資分布」在后，不能假设先后
    seg = t[m1.start():] + '\n'
    # 按行推进：序号行 + 含中文的标签行 + 数值行，三行一组；顺带跳过图例编号区
    lines = [l.strip() for l in seg.split('\n')]
    alloc = []
    i = 0
    while i < len(lines) - 2:
        if (re.fullmatch(r'\d{1,2}', lines[i])
                and re.search(r'[\u4e00-\u9fff]', lines[i + 1])
                and re.fullmatch(r'-?\d+(?:\.\d+)?', lines[i + 2])):
            alloc.append({'label': label_of(lines[i + 1]), 'weight': float(lines[i + 2])})
            i += 3
        else:
            i += 1
    # 十大投资：从「十大投資」到「投資分布」（若分布在前则取到文末）
    top = []
    seg2 = t[m2.start():m1.start()] if m1.start() > m2.start() else t[m2.start():]
    for nm, w in re.findall(r'\n([^\n]{3,90})\n(\d+(?:\.\d+)?)\s*\n', seg2):
        if re.search(r'基金|評論|表現|單位|類別', nm):
            continue
        top.append({'name': nm.strip()[:80], 'weight': float(w)})
        if len(top) >= 10:
            break
    return alloc, top


def main():
    write = '--write' in sys.argv
    doc = pymupdf.open(PDF)
    asof = None
    m = re.search(r'As at (\d{1,2})/(\d{1,2})/(\d{4})', doc[3].get_text())
    if m:
        asof = '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))

    found = {}
    for pi in range(doc.page_count):
        t = doc[pi].get_text()
        for name in MAP:
            if name in t and '投資分布' in t:
                a, top = parse_page(t)
                if a:
                    found[name] = {'page': pi + 1, 'alloc': a, 'top10': top}
    print('PDF 报告期：%s' % asof)
    h = json.load(open(HOLD, encoding='utf-8'))
    n = 0
    for name, ids in MAP.items():
        v = found.get(name)
        if not v:
            print('✗ %s 未解析到' % name)
            continue
        s = round(sum(x['weight'] for x in v['alloc']), 2)
        print('\n%s（p%d） 分布 %d 条 合计 %.2f  十大 %d 条'
              % (name, v['page'], len(v['alloc']), s, len(v['top10'])))
        for x in v['alloc']:
            print('    %-10s %6.2f' % (x['label'], x['weight']))
        if write:
            for fid in ids:
                rec = h['funds'].setdefault(fid, {})
                rec['alloc'] = v['alloc']
                rec['allocSum'] = s
                rec['allocIncomplete'] = abs(s - 100) > 0.5
                # 十大持仓不在此脚本覆盖：本版的十大区块后面紧接业绩表，
                # 行式正则会把业绩数字误当持仓（旧数据经逐条核对是对的，保持不动）
                n += 1
    if write:
        json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
        print('\n已写回 %d 条' % n)


if __name__ == '__main__':
    main()
