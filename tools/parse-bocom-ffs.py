# -*- coding: utf-8 -*-
"""交通銀行 便覽解析（tools/parse-bocom-ffs.py）
====================================================================
PDF: https://www.mpfa.org.hk/assets/FF/MT00393.pdf（交通銀行愉盈退休強積金計劃，截至 30/06/2026）
     也可用官網版 tmp/bocom_ffs.pdf，结构相同。

版式（2026-06 实测）：
  一页上下两只基金，标题「交通銀行XX基金」在左缘（x≈30），据此切 y-band。
  band 内三栏：
    左栏 x<260   投资目标 / 评论
    中栏 x 250-380 资产分佈（两个子列：左 x≈266-320、右 x≈340-370）
                   每项 = 中文标签行 + 英文标签行 + 百分比行；同列内「中文标签 → 其后第一个百分比」即配对
    右栏 x>380    十大資產：`1. US Treasury Note/Bond 3.875% 04/31 10.78%`（序号. 名称 … 权重%）

用法：python tools/parse-bocom-ffs.py tmp/ff_jt.pdf [--write]
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
SRC = '交通銀行「基金便覽」PDF（季度，經積金局匯總）'

# 这两只的资产分佈是图形饼图，标签与引线交错，坐标配对不可靠；
# 2026-10-24 渲染 300dpi 后视觉识别读出，合计均 100.0，录此兜底。
OCR_ALLOC = {
    '交通銀行環球債券成分基金': [
        ('其他債券', 5.0), ('現金及其他', 1.6), ('中國香港債券', 19.6), ('日本債券', 5.9),
        ('其他亞太地區債券', 12.7), ('歐洲債券', 19.9), ('美元集團債券', 35.3),
    ],
    '交通銀行核心累積基金': [
        ('現金及其他', 2.9), ('債券', 35.4), ('中國香港股票', 1.3), ('日本股票', 3.5),
        ('其他亞太地區股票', 6.2), ('歐洲股票', 8.6), ('北美股票', 41.3), ('其他股票', 0.8),
    ],
}

# 1521 的十大：序号行与权重行交替错位（如「2.9%」单独一行落在第 2 条之前），
# 逐行配对会丢 3 条；按原文逐条核对后兜底（与 PDF 第 3 页文字层完全一致）。
OCR_TOP = {
    '交通銀行核心累積基金': [
        ('Nvidia Corp', 3.1), ('蘋果公司 Apple Inc', 2.9),
        ('US Treasury Note/Bond 4.375% 01/32', 2.5), ('Alphabet Inc-CI A', 1.9),
        ('US Treasury Note/Bond 0.625% 05/30', 1.9), ('微軟 Microsoft Corp', 1.9),
        ('United Kingdom Gilt 4.5% 03/35', 1.8), ('US Treasury Note/Bond 4.625% 06/27', 1.7),
        ('New Zealand Government 4.5% 05/35', 1.6), ('Canadian Government 3.25% 06/35', 1.6),
    ],
}

TARGET = {
    '交通銀行環球債券成分基金': ['830'],
    '交通銀行核心累積基金': ['1521'],
}
PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')
ZH = re.compile(r'[\u4e00-\u9fff]')


def rows(page, y0, y1, x0=0, x1=9999):
    b = {}
    for w in page.get_text('words'):
        if not (y0 <= w[1] < y1) or not (x0 <= w[0] < x1):
            continue
        b.setdefault(round(w[1] / 2.0), []).append((w[0], w[4]))
    return [(k, [t for _, t in sorted(v)]) for k, v in sorted(b.items())]


BLACK = ('年初至今', '基金風險標記', '曆年回報', '基金表現', '基金開支', '單位資產',
         '基金資產值', '風險級別', '平均成本法', '累積回報', '年度化', '投資目標')


def anchor(page, y0, y1, kw, x0=0, x1=9999):
    """返回 band 内关键词所在行 y（找不到返回 None）"""
    for w in page.get_text('words'):
        if y0 <= w[1] < y1 and x0 <= w[0] < x1 and kw in w[4]:
            return w[1]
    return None


def parse_alloc(page, y0, y1):
    """中栏两个子列各自「中文标签 → 其后第一个百分比」配对"""
    out = []
    for cx0, cx1 in ((250, 335), (335, 382)):
        pending = ''
        for _, toks in rows(page, y0, y1, cx0, cx1):
            line = ' '.join(toks)
            pcts = [t for t in toks if PCT.match(t)]
            zh = [t for t in toks if ZH.search(t)]
            if pcts and pending:
                out.append({'label': pending, 'weight': float(pcts[0][:-1])})
                pending = ''
                continue
            if zh and not pcts:
                cand = max(zh, key=len)
                if cand in ('資產分佈', '現金及其他'):
                    pending = '現金及其他' if cand == '現金及其他' else pending
                    continue
                if len(cand) >= 2 and not any(b in cand for b in BLACK):
                    pending = cand
    return out


def parse_top(page, y0, y1):
    """序号行 + 名称，权重可能在同行末尾、也可能单独成行（本版式常见交错）"""
    out = []
    pending = None          # 尚未分配出去的百分比
    for _, toks in rows(page, y0, y1, 380, 9999):
        line = ' '.join(toks)
        pcts = [t for t in toks if PCT.match(t)]
        if re.match(r'^\d{1,2}\.\s*$', line) or re.match(r'^\d{1,2}\.', line):
            name = re.sub(r'^\d{1,2}\.\s*', '', line)
            name = re.sub(r'\s*-?\d+(?:\.\d+)?%\s*$', '', name).strip()
            if not name:
                continue
            if pcts:
                out.append({'name': name[:80], 'weight': float(pcts[-1][:-1])})
                pending = None
            elif pending is not None:
                out.append({'name': name[:80], 'weight': pending})
                pending = None
            else:
                out.append({'name': name[:80], 'weight': None})
            continue
        if len(toks) == 1 and pcts:
            if out and out[-1]['weight'] is None:
                out[-1]['weight'] = float(pcts[0][:-1])
            else:
                pending = float(pcts[0][:-1])
    return [x for x in out if x['weight'] is not None][:10]


def main():
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(BASE, 'tmp', 'ff_jt.pdf')
    write = '--write' in sys.argv
    doc = pymupdf.open(path)
    asof = None
    m = re.search(r'截至\s*As of\s*:?\s*(\d{1,2})/(\d{1,2})/(\d{4})', doc[0].get_text())
    if m:
        asof = '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))
    print('PDF:', os.path.basename(path), ' 报告期:', asof)

    found = {}
    for pi in range(doc.page_count):
        page = doc[pi]
        # 标题：x<60 且以「交通銀行」开头、以「基金」结尾
        titles = []
        for w in page.get_text('words'):
            t = w[4]
            if w[0] < 60 and t.startswith('交通銀行') and t.endswith('基金'):
                titles.append((w[1], t))
        titles.sort()
        for i, (y, name) in enumerate(titles):
            y1 = titles[i + 1][0] - 2 if i + 1 < len(titles) else 9999
            if name not in TARGET:
                continue
            ay = anchor(page, y, y1, '資產分佈', 250, 382) or y
            ty = anchor(page, y, y1, '十大資產', 380) or y
            alloc = parse_alloc(page, ay, y1)
            top = parse_top(page, ty, y1)
            s = round(sum(a['weight'] for a in alloc), 2)
            print('  p%-2d %-22s top=%2d 分佈=%2d 合计=%6.2f' % (pi + 1, name, len(top), len(alloc), s))
            if name in OCR_TOP and len(top) != 10:
                top = [{'name': k, 'weight': v} for k, v in OCR_TOP[name]]
                print('      ↳ 十大采用逐条核对结果：%d 条' % len(top))
            if (not alloc or abs(s - 100) > 0.5 or name in OCR_ALLOC) and name in OCR_ALLOC:
                alloc = [{'label': k, 'weight': v} for k, v in OCR_ALLOC[name]]
                s = round(sum(a['weight'] for a in alloc), 2)
                print('      ↳ 采用图形识别结果：合计 %.2f' % s)
            if not alloc or not top:
                continue
            found[name] = {'alloc': alloc, 'top10': top, 'sum': s}

    if not write:
        for name, v in found.items():
            print('\n==', name)
            for a in v['alloc']:
                print('    %-14s %6.2f' % (a['label'], a['weight']))
            for t in v['top10'][:3]:
                print('    · %-52s %5.2f' % (t['name'][:52], t['weight']))
        print('\n（未写库；加 --write）')
        return

    if not asof:
        print('✗ 报告期未取到，终止')
        return
    h = json.load(open(HOLD, encoding='utf-8'))
    n = 0
    for name, v in found.items():
        for fid in TARGET[name]:
            rec = h['funds'].setdefault(fid, {})
            rec['asOf'] = asof
            rec['top10'] = v['top10']
            rec['alloc'] = v['alloc']
            rec['allocSum'] = v['sum']
            rec['allocIncomplete'] = abs(v['sum'] - 100) > 0.5
            rec['src'] = SRC
            n += 1
    json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
    print('\n已写回 %d 条' % n)


if __name__ == '__main__':
    main()
