# -*- coding: utf-8 -*-
"""中銀保誠 便覽解析（tools/parse-boci-ffs.py）
====================================================================
PDF: https://www.bocpt.com/media/2717/boci-mpf-factsheet-2026-q2-_r3.pdf
     （中銀保誠「簡易強積金計劃」季度基金便覽，截至 30/6/2026，每頁一隻基金）

版式：
    基金資產分佈 Asset Allocation (%)
      債券 Bonds / 36.4%        ← 标签(中/英) + 百分比，「現金及其他7」带脚注数字
    證券項目 Security Holdings
      1 / WESTPAC BANKING 3% A 28JAN2027 / 3.6%   ← 序号 + 名称 + 百分比
    十大資產項目 Top Ten Holdings                    ← 表在此标题之前结束
部分基金跨两页（p18/p19 核心累積、p20/p21 65歲後），需按基金名合并后解析。

用法：python tools/parse-boci-ffs.py [--write]
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
PDF = os.path.join(BASE, 'tmp', 'boci_fs.pdf')

# 基金名 → (holdings id, PDF 页码)。页码按 2Q26 版；脚本会校验该页确实含基金名，
# 若换季页码变动会明确报「页码校验失败」而不是静默写错。
MAP = {
    '中銀保誠中國股票基金': (['654'], 3),
    '中銀保誠香港股票基金': (['232'], 4),
    '中銀保誠強積金保守基金': (['230'], 17),
    '中銀保誠核心累積基金': (['1541'], 18),
    '中銀保誠65歲後基金': (['1542'], 20),
}
# 有两只基金的「資產分佈」是**纯图形（饼图），PDF 无文字层**，正则取不到。
# 2026-10-24 用页面渲染 + 视觉识别读出，逐项与图中合计核对为 100.0，录于此作为兜底。
OCR_ALLOC = {
    '中銀保誠中國股票基金': [
        ('金融', 28.6), ('科技', 20.8), ('可選消費', 19.5), ('工業', 6.6),
        ('醫療保健', 5.2), ('基礎材料', 4.7), ('電信', 4.6), ('能源', 3.6),
        ('日常消費品', 2.9), ('公用事業', 1.7), ('房地產', 1.3), ('現金及其他', 0.5),
    ],
    '中銀保誠65歲後基金': [
        ('債券', 75.2), ('股票', 23.7), ('現金及其他', 1.1),
    ],
}

PCT = re.compile(r'^(-?\d+(?:\.\d+)?)%$')
ZH = re.compile(r'[\u4e00-\u9fff]')


def clean_label(s):
    s = re.sub(r'\d+$', '', s.strip())      # 去掉脚注数字：現金及其他7
    m = re.findall(r'[\u4e00-\u9fff（）()、／/·\-]+', s)
    return max(m, key=len).strip() if m else s


def parse_alloc(seg):
    out = []
    pending = ''
    for raw in seg.split('\n'):
        s = raw.strip()
        if not s:
            continue
        if PCT.match(s):
            if pending:
                out.append({'label': pending, 'weight': float(s[:-1])})
                pending = ''
            continue
        if ZH.search(s) and 'Asset Allocation' not in s and '資產分佈' not in s:
            pending = clean_label(s)
    return out


def parse_top(seg):
    lines = [l.strip() for l in seg.split('\n') if l.strip()]
    out = []
    i = 0
    while i < len(lines) - 2:
        if re.fullmatch(r'\d{1,2}', lines[i]) and PCT.match(lines[i + 2]):
            out.append({'name': lines[i + 1][:80], 'weight': float(lines[i + 2][:-1])})
            i += 3
        else:
            i += 1
    return out[:10]


def parse_block(t):
    """區塊順序在部分頁面是反的（證券項目在前、資產分佈在後），按位置分情況取區間"""
    a0 = t.find('資產分佈')
    s0 = t.find('證券項目')
    t0 = t.find('十大資產項目')

    alloc, top = [], []
    if a0 >= 0:
        if s0 > a0:
            alloc = parse_alloc(t[a0:s0])
        else:
            alloc = parse_alloc(t[a0:a0 + 1800])
    if s0 >= 0:
        top = parse_top(t[s0:s0 + 2200])
    return alloc, top


def main():
    write = '--write' in sys.argv
    doc = pymupdf.open(PDF)
    asof = None
    # 报告期：首页「截至 30/6/2026」；不要扫其它页（那里是各基金成立日期）
    m = re.search(r'(\d{1,2})/(\d{1,2})/(\d{4})', doc[0].get_text())
    if m:
        asof = '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))

    pages = {}
    for name, (ids, pg) in MAP.items():
        if pg > doc.page_count:
            print('✗ %s 页码 %d 超出总页数' % (name, pg))
            continue
        t = doc[pg - 1].get_text()
        if name not in t:
            print('✗ %s 页码校验失败（p%d 未出现该基金名）' % (name, pg))
            continue
        pages[name] = [t]

    print('PDF 报告期：%s' % asof)
    found = {}
    for name in MAP:
        segs = pages.get(name) or []
        if not segs:
            print('✗ %s 未找到页' % name)
            continue
        alloc, top = [], []
        for seg in segs:
            a, tp = parse_block(seg)
            if a and not alloc:
                alloc = a
            if tp and not top:
                top = tp
        if not alloc and name in OCR_ALLOC:
            alloc = [{'label': k, 'weight': v} for k, v in OCR_ALLOC[name]]
            print('   ↳ 使用图形页识别结果：%s' % name)
        s = round(sum(x['weight'] for x in alloc), 2)
        found[name] = {'alloc': alloc, 'top10': top, 'sum': s}
        print('  %-22s 页%d  分布 %d 条 合计 %.2f  十大 %d 条'
              % (name, len(segs), len(alloc), s, len(top)))

    if not asof:
        print('\n✗ 未取到报告期，终止（不写库，避免 asOf 被写成 null）')
        return

    if not write:
        for name, v in found.items():
            print('\n%s' % name)
            for x in v['alloc']:
                print('    %-12s %6.2f' % (x['label'], x['weight']))
            for x in v['top10'][:3]:
                print('    · %-46s %5.2f' % (x['name'][:46], x['weight']))
        print('\n（未写库；加 --write 才写入 holdings.json）')
        return

    h = json.load(open(HOLD, encoding='utf-8'))
    n = 0
    for name, (ids, _pg) in MAP.items():
        v = found.get(name)
        if not v or not v['alloc']:
            print('  跳过（该页只有图形，无文字层分布）：%s' % name)
            continue
        for fid in ids:
            rec = h['funds'].setdefault(fid, {})
            rec['asOf'] = asof
            rec['alloc'] = v['alloc']
            rec['allocSum'] = v['sum']
            rec['allocIncomplete'] = abs(v['sum'] - 100) > 0.5
            if len(v['top10']) == 10:
                rec['top10'] = v['top10']
            rec['src'] = '中銀保誠「簡易強積金計劃」季度基金便覽 PDF（2Q26）'
            n += 1
    json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
    print('\n已写回 %d 条' % n)


if __name__ == '__main__':
    main()
