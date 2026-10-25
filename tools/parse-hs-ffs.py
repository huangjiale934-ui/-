#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""恒生 / 滙豐 基金便覽解析（2026 第二季）→ 覆盖 data/holdings.json
   用途：修正「持仓串号」与「资产分布合计不足」，按 PDF 每页一只基金逐页抽取。
   用法：python tools/parse-hs-ffs.py [--dry]
"""
import json, re, sys, os
import pymupdf

DRY = '--dry' in sys.argv
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HLD = os.path.join(ROOT, 'data', 'holdings.json')
FUNDS = os.path.join(ROOT, 'data', 'funds.json')

PDFS = [
    ('tmp/ffs_hs.pdf', '恒生強積金智選計劃'),
    ('tmp/invrpt.pdf', '滙豐強積金智選計劃'),
]

def norm(s):
    s = str(s or '')
    s = s.replace('•', ' ').replace('&', ' ').replace('Φ^', ' ')
    s = re.sub(r'\s+', '', s)
    return s

def parse_page(t):
    """返回 (基金名, top10[(name,weight)], alloc[(label,weight)])"""
    # 基金名：第一行，去掉英文部分与符号
    first = t.split('\n')[0].strip()
    name = re.split(r'[•&]', first)[0].strip()
    # 十大持股
    top = []
    m = re.search(r'持有量\s*Holdings\s*\(%\)', t)
    if m:
        seg = t[m.end():]
        seg = seg.split('基金表現資料')[0]
        lines = [x.strip() for x in seg.split('\n') if x.strip()]
        i = 0
        while i + 1 < len(lines) and len(top) < 12:
            a = lines[i]
            # 2026-10-23：首行常把「名称 + 权重」写在同一行（如「台灣積體電路 … 1.5」）
            inline = re.match(r'^(.*?[^\d\s])\s+(\d{1,2}\.\d)$', a)
            if inline and len(top) < 10:
                top.append((inline.group(1).strip(), float(inline.group(2))))
                i += 1
                continue
            b = lines[i + 1]
            if re.fullmatch(r'\d+(\.\d+)?', b):
                nm = re.sub(r'\s{2,}.*$', '', a)
                top.append((nm, float(b)))
                i += 2
            elif i + 2 < len(lines) and re.fullmatch(r'\d+(\.\d+)?', lines[i + 2]):
                # 2026-10-23 修（核验报告 #2）：基金名折成两行时，原实现会漏掉这一条
                nm = re.sub(r'\s{2,}.*$', '', a + ' ' + b)
                top.append((nm, float(lines[i + 2])))
                i += 3
            else:
                i += 1
    # 资产分布：pct 连续块 + 标签块
    alloc = []
    m2 = re.search(r'投資組合分布[^\n]*', t)
    if m2:
        seg = t[m2.end():]
        seg = seg.split('評論')[0]
        lines = [x.strip() for x in seg.split('\n') if x.strip()]
        pcts, labels, cur = [], [], []
        for ln in lines:
            if re.fullmatch(r'\d+(\.\d+)?%', ln):
                if labels: break
                pcts.append(float(ln.rstrip('%')))
            else:
                labels.append(ln)
        # 2026-10-23 修（核验报告 #3）：标签会被 PDF 折行拆开（如「亞太股票（中國內地╱香港╱」+「日本除外）」），
        # 原实现按下标硬配，导致括号断裂且其后标签整体错位一位。改为「先把折行拼成完整标签」。
        cand = []
        buf = ''
        for x in labels:
            if not re.match(r'[\u4e00-\u9fa5]', x):
                continue
            piece = re.sub(r'\s*[A-Za-z][A-Za-z /()\-–&]*$', '', x).strip()
            piece = re.sub(r'\s*[A-Za-z]\s*&\s*$', '', piece).strip()
            if not piece:
                continue
            buf = (buf + piece) if buf else piece
            # 括号平衡才算一个完整标签
            if buf.count('（') + buf.count('(') <= buf.count('）') + buf.count(')'):
                cand.append(buf)
                buf = ''
        if buf:
            cand.append(buf)
        for k, p in enumerate(pcts):
            lab = cand[k] if k < len(cand) else ''
            if lab:
                alloc.append((lab, p))
    return name, top, alloc

def main():
    funds = json.load(open(FUNDS, encoding='utf-8'))['funds']
    hld = json.load(open(HLD, encoding='utf-8'))
    touched = 0
    for path, scheme in PDFS:
        d = pymupdf.open(os.path.join(ROOT, path))
        ours = [f for f in funds if f.get('scheme') == scheme]
        byn = {}
        for f in ours:
            byn.setdefault(norm(f['fund']), []).append(f)
        for pno in range(len(d)):
            name, top, alloc = parse_page(d[pno].get_text())
            if not top and not alloc:
                continue
            key = norm(name)
            matches = byn.get(key)
            if not matches:
                # 容错：去掉「基金」后缀再匹配
                key2 = norm(name.replace('基金', ''))
                matches = [f for f in ours if norm(f['fund']).startswith(key2) and key2]
                matches = matches[:2]
            if not matches:
                print('  [?] 未匹配页面', pno, name)
                continue
            for f in matches:
                fid = str(f['id'])
                cur = hld['funds'].setdefault(fid, {})
                old_top = [x['name'] for x in (cur.get('top10') or [])][:3]
                new_top = [x[0] for x in top][:3]
                changed = old_top != new_top
                if not DRY:
                    if top:
                        cur['top10'] = [{'name': n, 'weight': w} for n, w in top]
                    if alloc:
                        cur['alloc'] = [{'label': l, 'weight': w} for l, w in alloc]
                        cur['allocSum'] = round(sum(w for _, w in alloc), 2)
                    cur['asOf'] = '2026-06-30'
                    cur['src'] = '官方基金便覽 PDF（2026 第二季）'
                touched += 1
                if changed:
                    print('  修正', fid, f['fund'][:20], old_top, '→', new_top)
    if not DRY:
        json.dump(hld, open(HLD, 'w', encoding='utf-8'), ensure_ascii=False)
    print('处理基金', touched, '只', '（dry-run）' if DRY else '已写盘')

if __name__ == '__main__':
    main()
