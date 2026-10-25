# -*- coding: utf-8 -*-
"""海通 MPF 基金便覽解析（tools/parse-haitong-ffs.py）
====================================================================
数据源：https://gthtam.com.hk/hti_content/images/mpf/Haitong_MPF_Conservative_Fund/
        FundDocument/6/zh-CHT/海通強積金保守基金 - 基金概覽.pdf
        该文件是「基金經理報告 / Fund Monitor」，**一页两只基金**（上下分栏），
        第 6 页只剩一只。这正是旧解析器「只取第一个 Top 区块」漏数据的原因。

版式（2026-08 实测）：
  - 每只基金一个 y-band，标题行 "Haitong XXX Fund 海通XXX基金*" 位于左半页
  - band 内右栏依次是：ASSET ALLOCATION（英文名 / 百分比 / 中文名 三行一组，
    或 "English 中文 12.34%" 同行）→ TOP TEN HOLDINGS（"名称 权重" 同行，
    债券票息折行时会出现碎片行）
  - 全篇日期 "as of 31/08/2026"

用法：
  python tools/parse-haitong-ffs.py            # 解析 + 打印核对表
  python tools/parse-haitong-ffs.py --write    # 写回 holdings.json
"""
import json
import os
import re
import sys
import time

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
PDF = os.path.join(BASE, 'tmp', 'ht_cons.pdf')
SRC = '海通「基金概覽／基金經理報告」PDF（季度，走 Chrome 下载）'

PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')
NUM = re.compile(r'^-?\d+(?:\.\d+)?$')
ZH = re.compile(r'[\u4e00-\u9fff]')

# 便览基金名 → funds.json 里的 fundBase（同一基金有 A/T 两个单位类别，各两条记录）
TARGET = {
    'Haitong MPF Conservative Fund': ['288', '289'],
    'Haitong Korea Fund': ['284', '285'],
    'Haitong Core Accumulation Fund': ['1553', '1554'],
}


def rows_of(page, y0, y1, cx0=270, cx1=540):
    """右栏区域内按 y 聚类成行（容差 4pt），返回行文本列表"""
    buckets = {}
    for w in page.get_text('words'):
        x0, yy0, x1, yy1, t = w[0], w[1], w[2], w[3], w[4]
        if not (y0 <= yy0 < y1) or not (cx0 <= x0 < cx1):
            continue
        k = round(yy0 / 4.0)
        buckets.setdefault(k, []).append((x0, yy0, t))
    out = []
    for k in sorted(buckets):
        ws = sorted(buckets[k], key=lambda z: z[0])
        out.append(' '.join(z[2] for z in ws))
    return out


def zh_part(s):
    """取标签里的中文段（含括号），没有则回退原文"""
    m = re.findall(r'[\u4e00-\u9fff（）()、／/·\-0-9]+', s)
    if not m:
        return s.strip()
    return max(m, key=len).strip()


def parse_alloc(lines):
    """解析 ASSET ALLOCATION 行序列 → [{label, weight}]"""
    out = []
    pending = ''
    pending_zh = ''
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        if 'Net Asset' in s or '佔淨資產' in s or 'ASSET ALLOCATION' in s:
            continue
        if '十大' in s or 'TOP TEN' in s:
            break
        # 坐标轴刻度行（0% 10% 20% ...）
        if len(re.findall(r'\d+%', s)) >= 3:
            continue
        if PCT.match(s):
            if pending:
                out.append({'label': zh_part(pending) if not pending_zh else pending_zh, 'weight': float(s[:-1])})
                pending = ''
                pending_zh = ''
            continue
        m = re.search(r'(-?\d+(?:\.\d+)?)%\s*$', s)
        if m:
            head = s[:m.start()].strip()
            lbl = zh_part(head)
            if pending_zh and not ZH.search(head):
                lbl = pending_zh
            out.append({'label': lbl, 'weight': float(m.group(1))})
            pending = ''
            pending_zh = ''
            continue
        # 纯中文行：源档里中文名可能出现在英文名之前（如「加拿大股票 / Canada Equities 0.76」）
        if ZH.search(s) and not re.search(r'[A-Za-z]{3}', s):
            if out and out[-1]['label'].isascii():
                out[-1]['label'] = zh_part(s)
                pending_zh = ''
            else:
                pending_zh = zh_part(s)
            continue
        pending = s
    return out


def parse_top(lines):
    """解析 TOP TEN HOLDINGS 行序列 → [{name, weight}]"""
    out = []
    buf = []
    started = False
    for raw in lines:
        s = raw.strip()
        if not s:
            continue
        if not started:
            if 'TOP TEN' in s or '十大' in s:
                started = True
            continue
        if 'Net Asset' in s or '佔淨資產' in s or 'Securities' in s or '證券' in s:
            continue
        if re.fullmatch(r'[A-Za-z]{2,12}', s):   # 表头碎词：Value / Securities …
            continue
        toks = s.split()
        # 权重单独成行（如 Korea 最后一条 Hana Financial Group Inc / 2.69）
        if len(toks) == 1 and NUM.match(toks[0]) and buf:
            name = ''.join(buf)
            buf = []
            out.append({'name': name[:96], 'weight': float(toks[0])})
            if len(out) >= 10:
                break
            continue
        if len(toks) >= 2 and NUM.match(toks[-1]):
            name = ' '.join(toks[:-1]).strip()
            # 碎片归位：数字开头（债券票息）接名称后；含字母且较长（名称前半段）接名称前；
            # 其余（The / of 这类排版碎片）丢弃
            pre = ''.join(x for x in buf if not re.match(r'^\d', x) and len(x) >= 8 and re.search(r'[A-Za-z]', x))
            post = ''.join(x for x in buf if re.match(r'^\d', x))
            buf = []
            full = pre + name + post
            # 中英文与数字直接相邻时补一个空格（Agricultural Bank of China2.85%…）
            full = re.sub(r'(?<=[A-Za-z\u4e00-\u9fff])(?=\d)', ' ', full)
            out.append({'name': full[:96], 'weight': float(toks[-1])})
            if len(out) >= 10:
                break
            continue
        buf.append(s)
    return out


def main():
    write = '--write' in sys.argv
    doc = pymupdf.open(PDF)
    asof = None
    for pg in doc:
        m = re.search(r'as of\s*(\d{2})/(\d{2})/(\d{4})', pg.get_text())
        if m:
            asof = '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1)))
            break

    found = {}
    for pi in range(doc.page_count):
        page = doc[pi]
        heads = []
        for y, ws in [(None, None)] if False else []:
            pass
        # 找基金标题行（左半页）
        buckets = {}
        for w in page.get_text('words'):
            if w[0] >= 270:
                continue
            buckets.setdefault(round(w[1] / 4.0), []).append((w[0], w[1], w[4]))
        titles = []
        for k in sorted(buckets):
            txt = ' '.join(t for _, _, t in sorted(buckets[k], key=lambda z: z[0]))
            m = re.match(r'^(Haitong [A-Za-z0-9 ()\-]+Fund)\b', txt)
            if m:
                titles.append((min(z[1] for z in buckets[k]), m.group(1)))
        for i, (y0, name) in enumerate(titles):
            y1 = titles[i + 1][0] - 2 if i + 1 < len(titles) else 10000
            lines = rows_of(page, y0, y1)
            ai = next((k for k, l in enumerate(lines) if 'ASSET ALLOCATION' in l), None)
            ti = next((k for k, l in enumerate(lines) if 'TOP TEN' in l), None)
            if ai is None or ti is None or ti < ai:
                continue
            found[name] = {
                'page': pi + 1,
                'alloc': parse_alloc(lines[ai:ti]),
                'top10': parse_top(lines[ti:]),
                'allocSum': None,
            }

    print('PDF 报告期：%s' % asof)
    print('识别到基金：%d 只' % len(found))
    ok = True
    for name, v in found.items():
        s = round(sum(a['weight'] for a in v['alloc']), 2)
        v['allocSum'] = s
        flag = ''
        if abs(s - 100) > 1.0:
            flag += '  ⚠分布合计%.2f' % s
        if len(v['top10']) != 10:
            flag += '  ⚠top10=%d' % len(v['top10'])
        print('  p%-2d %-38s top=%2d 分布=%2d 合计=%6.2f%s'
              % (v['page'], name, len(v['top10']), len(v['alloc']), s, flag))
        if flag:
            ok = False

    print('\n关注的三只：')
    for name, ids in TARGET.items():
        v = found.get(name)
        if not v:
            print('  ✗ 未找到 %s' % name)
            ok = False
            continue
        print('  ✓ %s → %s  top=%d 分布=%d' % (name, ','.join(ids), len(v['top10']), len(v['alloc'])))
        for a in v['alloc']:
            print('       %-16s %6.2f' % (a['label'], a['weight']))
        for t in v['top10'][:3]:
            print('       · %-40s %5.2f' % (t['name'][:40], t['weight']))

    if not write:
        print('\n（未写库；加 --write 才写入 holdings.json）')
        return

    h = json.load(open(HOLD, encoding='utf-8'))
    n = 0
    for name, ids in TARGET.items():
        v = found.get(name)
        if not v:
            continue
        for fid in ids:
            rec = h['funds'].setdefault(fid, {})
            rec['asOf'] = asof
            rec['top10'] = v['top10']
            rec['alloc'] = v['alloc']
            rec['src'] = SRC
            rec['allocLabel'] = '資產分佈'
            rec['allocTitle'] = '投資組合分布'
            rec['allocSum'] = v['allocSum']
            rec['allocIncomplete'] = abs(v['allocSum'] - 100) > 0.5
            rec.pop('srcStatus', None)
            rec.pop('srcNote', None)
            n += 1
    h['updatedAt'] = int(time.time() * 1000)
    json.dump(h, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False)
    print('\n已写回 holdings.json：%d 条' % n)


if __name__ == '__main__':
    main()
