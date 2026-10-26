#!/usr/bin/env python3
"""持仓/分布条目质量判定（2026-10-26 新增）
背景：2026-10-26 季度抓取时，BCT 解析器把 19 只 top10 名称写成空、20 只资产分布塌缩成 1 行，
      而 holdings-guard.js 是「写盘后」才检查 → 坏数据已经落盘，只能人工回滚。
      本模块把判据前置到写盘之前，供 bct_ffs2.py / bct_holdings.py 等写入方直接调用。

判据与 tools/holdings-guard.js 的规则 B 保持一致（同一口径，避免两套标准）：
  1) top10 名称不得为空
  2) top10 合计 ≤ 100.5（混入评级桶/统计行会爆表）
  3) top10 不得混入统计行或评级桶
  4) alloc 存在时行数不得 < 2（塌缩判定）
用法：
  from holdings_filter import errors, is_degraded
  errs = errors(candidate)                 # 返回 ['空名稱', ...]，空列表=合规
  if is_degraded(old_entry, candidate):    # 旧的好、新的坏 → 拒绝写入
      ...
"""
import re

STAT = re.compile(r'Fund Risk Indicator|Yield to Maturity|Expense Ratio|Modified Duration|Credit Rating', re.I)
BUCKET = re.compile(r'^(AAA|AA/Aa|A|BBB/Baa|BBB|B|CCC|Others\*)$', re.I)
CTRL = re.compile(r'[\u0000-\u0008\u000B\u000C\u000E-\u001F]')


def _num(v, d=0.0):
    try:
        return float(v)
    except (TypeError, ValueError):
        return d


def errors(e):
    """返回条目问题列表；空列表表示合规。"""
    if not e:
        return ['空条目']
    errs = []
    top = e.get('top10') or []
    if top:
        if any(not str(x.get('name') or '').strip() for x in top):
            errs.append('空名稱')
        s = sum(_num(x.get('weight')) for x in top)
        if s > 100.5:
            errs.append('合計%.1f' % s)
        if any(STAT.search(str(x.get('name') or '')) or BUCKET.match(str(x.get('name') or '').strip()) for x in top):
            errs.append('統計行')
        if CTRL.search(''.join(str(x.get('name') or '') for x in top)):
            errs.append('控制字符')
    alloc = e.get('alloc')
    if alloc is not None and len(alloc) < 2:
        errs.append('分布塌縮')
    return errs


def is_degraded(old, new):
    """旧条目合规、新条目不合规 → 视为退化（应保留旧数据）。"""
    if not new:
        return False
    if not errors(new):
        return False
    return not errors(old or {})
