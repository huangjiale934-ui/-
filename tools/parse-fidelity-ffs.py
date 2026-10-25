# -*- coding: utf-8 -*-
"""富達 便覽解析（tools/parse-fidelity-ffs.py）
====================================================================
PDF: https://www.mpfa.org.hk/assets/FF/MT00288.pdf（富達退休集成信託月報，截至 30/06/2026）
     每只基金一页数据页。

版式：
    「Top 10 Holdings 十大主要投資項目」：名称行 / 百分比行 交替，末尾有 TOTAL 總和
    分佈區兩種版式（按基金類型不同）：
      A. 「Fund Allocation by Asset Class▲ 資產類別投資分配▲」：名称行 / 百分比行 两行一组
      B. 「Industry Breakdown▲ 行業投資分佈▲」：百分比在前（行首或独行）、名稱在後且可能跨行
         例：`48.7% Financial 金融`、`33.3% Quasi/Sov/Supra/Agncy` + `半政府/主權/超國家/` + `機構債券`
    日期：`As of 截至 30/06/2026`

2026-10-24：PAGE 3→19 只（覆蓋 mpf.hk 轉載的富達 20 只中除 1799/2079 外的全部；
            1799 退休易、2079 美洲已走富達官方便覽月報（更優來源），本腳本不回寫以免降級）。

用法：python tools/parse-fidelity-ffs.py tmp/ff_fid.pdf --write
"""
import json
import os
import re
import sys

import pymupdf

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
# (fid, page, type)：type = asset 資產類別 / industry 行業分佈
PAGE = {
    '強積金保守基金': ('274', 26, 'asset'),
    '增長基金': ('268', 16, 'asset'), '平穩增長基金': ('271', 18, 'asset'),
    '資本穩定基金': ('272', 19, 'asset'), '均衡基金': ('280', 17, 'asset'),
    '環球股票基金': ('275', 11, 'asset'),
    '核心累積基金': ('1551', 21, 'asset'), '65歲後基金': ('1552', 22, 'asset'),
    '富達「儲蓄易」2025基金': ('706', 32, 'asset'), '富達「儲蓄易」2030基金': ('708', 31, 'asset'),
    '富達「儲蓄易」2035基金': ('709', 30, 'asset'), '富達「儲蓄易」2040基金': ('711', 29, 'asset'),
    '富達「儲蓄易」2045基金': ('1419', 28, 'asset'), '富達「儲蓄易」2050基金': ('1420', 27, 'asset'),
    '亞太股票基金': ('278', 10, 'industry'), '香港股票基金': ('273', 12, 'industry'),
    '歐洲股票基金': ('2080', 14, 'industry'), '富達香港盈富基金': ('1159', 15, 'industry'),
    '香港債券基金': ('276', 23, 'industry'), '人民幣債券基金': ('1439', 24, 'industry'),
    '國際債券基金': ('270', 25, 'industry'),
}
SRC = '富達「基金便覽」PDF（月度，經積金局匯總）'
PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')
ZH = re.compile(r'[\u4e00-\u9fff／/]+')
# 行業區終止：腳注/下一區塊標題
IND_STOP = re.compile(
    r'^[\*#\^]|may include|May include|Due to rounding|Source[:：]|資料來源'
    r'|Fidelity Retirement Master Trust|Investment involves|Top 10 Holdings'
    r'|Fund Performance|Unit NAV|Fund Size|Fund Details|As of 截至|S&P/Moody')


def parse_asof(t):
    m = re.search(r'As of\s*截至\s*(\d{1,2})/(\d{1,2})/(\d{4})', t)
    return '%s-%02d-%02d' % (m.group(3), int(m.group(2)), int(m.group(1))) if m else None


PCT = re.compile(r'^-?\d+(?:\.\d+)?%$')
# 統計行/評級桶過濾（這些不是持倉）
NAME_BAD = re.compile(
    r'Fund Risk Indicator|Yield to Maturity|Expense Ratio|Modified Duration'
    r'|Standard Deviation|Credit Rating|◊|▲|♯|ɸ'
    r'|^(AAA|AA\/Aa|A|BBB\/Baa|BBB|B|CCC|Others\*|D\*|Other#)\s*$')
STOP_BACK = re.compile(
    r'Fidelity Retirement Master Trust|^Investment involves|^1\s+This is'
    r'|^\^ as of|Source[:：]|資料來源|^# May|^\* Others may|Due to rounding')


def parse_top(t):
    """十大：以 PDF 自帶『TOTAL 總和 XX%』為錨，從錨向前回溯『名稱行/百分比行』對；
    合計與 TOTAL 對不上（±0.5）視為解析失敗返回空（寧缺勿錯）。
    2026-10-24 重寫：舊版從標題向後掃，債券頁會越界吃進信用評級桶/風險指標區
    （270 曾被解析成 AAA/Aaa 62.6% 開頭、合計 132.79%）。"""
    m_total = re.search(r'TOTAL\s*總和\s*\n\s*(\d+(?:\.\d+)?)\s*%', t)
    if not m_total:
        return []
    total_v = float(m_total.group(1))
    lines = [l.strip() for l in t[:m_total.start()].split('\n') if l.strip()]
    top = []
    # 錨（'TOTAL 總和'）已被切掉：直接從尾部反向配對『pct 行 + 名稱行』
    k = len(lines) - 1
    while k >= 0 and len(top) < 10:
        ln = lines[k]
        if STOP_BACK.search(ln):
            break
        if PCT.match(ln):
            nm = lines[k - 1] if k - 1 >= 0 else ''
            if nm and not PCT.match(nm) and not NAME_BAD.search(nm):
                top.insert(0, {'name': nm[:80], 'weight': float(ln[:-1])})
                k -= 2
            else:
                k -= 1
        else:
            # 名稱+數值同行（表首行常見，如 'HSBC GF ICAV - ... UCITS ETF 7.32%'）
            m2 = re.match(r'^(.*\S)\s+(\d{1,2}(?:\.\d+)?)\s*%$', ln)
            if m2 and not NAME_BAD.search(m2.group(1)):
                top.insert(0, {'name': m2.group(1)[:80], 'weight': float(m2.group(2))})
            k -= 1
    if len(top) != 10:
        return []
    if abs(sum(x['weight'] for x in top) - total_v) > 0.5:
        return []
    return top


# 分佈區終止標記（部分頁面分佈區後緊接 Top 10，無 Fund Performance 邊界）
SEG_STOPS = ['Top 10 Holdings', 'Fund Performance', 'As of 截至', '# May', '* Others',
             'Investment involves', 'Unit NAV', 'Fund Size', 'Fund Details', 'Fund Descriptor']


def seg_end(t, a):
    ends = [e for e in (t.find(s, a + 1) for s in SEG_STOPS) if e > 0]
    return min(ends) if ends else a + 600


def parse_asset(t):
    """資產類別投資分配：名称行 / 百分比行 两行一组"""
    alloc = []
    a = t.find('Fund Allocation')
    if a >= 0:
        seg = t[a:seg_end(t, a)]
        lines = [l.strip() for l in seg.split('\n') if l.strip()]
        k = 1
        while k < len(lines):  # 2026-10-24 修复 off-by-one：末行百分比行此前被漏掉
            if PCT.match(lines[k]) and not PCT.match(lines[k - 1]):
                raw = lines[k - 1]
                zh = re.findall(r'[\u4e00-\u9fff（）()、／/·\-#]+', raw)
                # 分佈区末尾会串入脚注/图例噪声：行内无汉字（纯英文/括号/斜杠）即终止
                # （标签行可含英文如 MONEY FUND 貨幣基金，但必有汉字）
                if (not re.search(r'[\u4e00-\u9fff]', raw)
                        or '景順' in raw or '摩根' in raw):
                    break
                alloc.append({'label': max(zh, key=len).strip().rstrip('#'), 'weight': float(lines[k][:-1])})
                k += 2
            else:
                k += 1
    return alloc


def parse_industry(t):
    """行業投資分佈：百分比在前（行首或独行），名稱在後且可能跨行；只認中文名稱"""
    alloc = []
    i = t.find('Industry Breakdown')
    if i < 0:
        return alloc
    lines = [l.strip() for l in t[i:].split('\n') if l.strip()][1:]  # 跳过标题行
    pct = None
    name = []

    def flush():
        nonlocal pct, name
        if pct is not None and name:
            alloc.append({'label': ''.join(name)[:40], 'weight': pct})
        pct, name = None, []

    for ln in lines:
        if IND_STOP.search(ln):
            break
        m = re.search(r'(\d+(?:\.\d+)?)\s*%', ln)
        if m:
            flush()
            pct = float(m.group(1))
            zh = [z for z in ZH.findall(re.sub(r'\d+(?:\.\d+)?\s*%', '', ln))
                  if re.search(r'[\u4e00-\u9fff]', z)]
            if zh:
                name = list(zh)
        else:
            zh = [z for z in ZH.findall(ln) if re.search(r'[\u4e00-\u9fff]', z)]
            if zh:
                name.extend(zh)
    flush()
    return alloc


def main():
    path = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith('--') else os.path.join(BASE, 'tmp', 'ff_fid.pdf')
    write = '--write' in sys.argv
    doc = pymupdf.open(path)
    h = json.load(open(HOLD, encoding='utf-8')) if write else None
    n = 0
    for name, (fid, pg, typ) in PAGE.items():
        t = doc[pg - 1].get_text()
        if name not in t:
            print('! p%d 未见 %s（该页可能用英文名，仍尝试解析）' % (pg, name))
        asof = parse_asof(t)
        top = parse_top(t)
        alloc = parse_asset(t) if typ == 'asset' else parse_industry(t)
        s = round(sum(x['weight'] for x in alloc), 2)
        print('%s p%d[%s] asOf=%s top=%d 分佈=%d 合计=%.2f' % (name, pg, typ, asof, len(top), len(alloc), s))
        for x in alloc:
            print('    %-16s %6.2f' % (x['label'], x['weight']))
        for x in top[:3]:
            print('    · %-52s %5.2f' % (x['name'][:52], x['weight']))
        if not write:
            continue
        top_sum = round(sum(x['weight'] for x in top), 2)
        if not asof or len(top) != 10 or not alloc or top_sum > 100.5 \
                or not (99.5 <= s <= 100.5 or len(alloc) >= 5):
            print('  ✗ 数据不完整或校验失败（top合计=%.2f）跳过' % top_sum)
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
