# -*- coding: utf-8 -*-
"""单位类别持仓同步（tools/sync-unit-class.py）
====================================================================
背景（2026-10-29 发现）：
  BCT 策略計劃的 12 只「H 类单位」与同 fundBase 的「A 类单位」共用同一投资组合，
  官方便览只在 A 类页披露 Top Ten Holdings。bct_ffs2.py 的兄弟复制逻辑有一条
  `if len(cur.top10) >= len(s.top10): continue`——两者都是 10 条时直接跳过，
  于是 A 类已到 2026-09-30、H 类仍停在 2026-08-31（asOf 永不跟随）。

本脚本只在「同 scheme + 同 fundBase + 兄弟 asOf 更新 + top10 条数相同」时，
把兄弟记录整体同步过来，并在 srcNote 注明来源为同组合的 A 类单位，保持可追溯。

用法：
  python tools/sync-unit-class.py           # 只打印将同步的条目
  python tools/sync-unit-class.py --write   # 写回 holdings.json
"""
import json
import os
import sys

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOLD = os.path.join(BASE, 'data', 'holdings.json')
FUNDS = os.path.join(BASE, 'data', 'funds.json')


def main():
    write = '--write' in sys.argv
    hld = json.load(open(HOLD, encoding='utf-8'))
    funds = json.load(open(FUNDS, encoding='utf-8'))['funds']
    H = hld['funds']

    groups = {}
    for f in funds:
        key = (f.get('scheme') or '', f.get('fundBase') or '')
        groups.setdefault(key, []).append(f)

    todo = []
    for key, members in groups.items():
        if len(members) < 2:
            continue
        # 找出该组合里 asOf 最新且 top10 完整的那一条作为基准
        ranked = sorted(
            [(str(m['id']), H.get(str(m['id'])) or {}) for m in members],
            key=lambda kv: (kv[1].get('asOf') or '', len(kv[1].get('top10') or [])),
            reverse=True,
        )
        base_id, base = ranked[0]
        if not base.get('asOf') or len(base.get('top10') or []) < 10:
            continue
        for fid, rec in ranked[1:]:
            if not rec:
                continue
            if (rec.get('asOf') or '') >= base['asOf']:
                continue
            if len(rec.get('top10') or []) != len(base.get('top10') or []):
                continue
            todo.append((fid, base_id, rec, base, key))

    for fid, base_id, rec, base, key in todo:
        print('#%-5s %-22s %s→%s  (基准 #%s, %s)' % (
            fid, key[1][:22], rec.get('asOf'), base['asOf'], base_id, key[0]))
    print('\n待同步 %d 条%s' % (len(todo), '' if write else '（未写库，加 --write 生效）'))
    if not write or not todo:
        return

    for fid, base_id, rec, base, key in todo:
        new = json.loads(json.dumps(base))
        new['src'] = base.get('src', '') + '（同组合单位类别共用，基准 #%s）' % base_id
        new['srcNote'] = 'H/A 类单位共用同一投资组合，按同组合最新披露同步（%s）' % base['asOf']
        hld['funds'][fid] = new

    hld['count'] = len(hld['funds'])
    import time
    hld['updatedAt'] = int(time.time() * 1000)
    json.dump(hld, open(HOLD, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('已写回 %d 条' % len(todo))


if __name__ == '__main__':
    main()
