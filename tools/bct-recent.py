# -*- coding: utf-8 -*-
"""BCT 近端净值补抓（轻量版，供 GitHub Actions 每日更新使用）
与 fetch-bct-hist.py（全量回补，依赖 tmp/ 暖缓存）不同：
本脚本只抓最近 N 个交易日（默认 10），按计划逐日请求 fundInformation 接口，
把返回的 priceDate/price 合并进 data/hist/<id>.json 与 data/hist-index.json。
冷启动约 6 计划 × 10 日 = 60 请求 ≈ 1 分钟。合并写入，不覆盖已有历史。
"""
import json, os, sys, time

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import importlib.util
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location('fbh', os.path.join(ROOT, 'fetch-bct-hist.py'))
fbh = importlib.util.module_from_spec(spec)
sys.argv = ['x', '--dry']          # 防止触发 fetch-bct-hist 的 main
spec.loader.exec_module(fbh)

from curl_cffi import requests as cffi

N_DAYS = 10
SLEEP = 0.5

def to_float(v):
    try:
        return round(float(v), 4)
    except (TypeError, ValueError):
        return None        # 'N/A' / None → 跳过

def main():
    s = cffi.Session(impersonate="chrome")
    hist_dir = os.path.join(fbh.DATA, 'hist')
    idx_path = fbh.INDEX
    idx = json.load(open(idx_path, encoding='utf-8'))
    hsi = json.load(open(os.path.join(fbh.DATA, 'index.json'), encoding='utf-8'))['items']['HSI']['series']
    recent = [d for d, _ in hsi][-N_DAYS - 1:-1]     # 跳过最新 1 天（T+1 宽限）

    FN = json.load(open(os.path.join(fbh.DATA, 'funds.json'), encoding='utf-8'))['funds']
    by_scheme = {}
    for x in FN:
        sc = x.get('scheme') or ''
        for sid, name in fbh.SCHEMES.items():
            if name in sc:
                by_scheme.setdefault(sid, []).append(x)

    got = fail = 0
    for sid, lst in sorted(by_scheme.items()):
        for d in recent:
            try:
                r = s.get(fbh.API, params={"lang": "zh", "schemaInfoId": sid, "date": d},
                          headers=fbh.UA, timeout=60)
                rows = (r.json().get("data") or {}).get("fundInformationList") or []
            except Exception:
                fail += 1
                time.sleep(SLEEP)
                continue
            if not rows:
                fail += 1
                time.sleep(SLEEP)
                continue
            for x in lst:
                p = os.path.join(hist_dir, str(x['id']) + '.json')
                if not os.path.exists(p):
                    continue
                try:
                    o = json.load(open(p, encoding='utf-8'))
                except Exception:
                    continue
                ser = o.get('series') or []
                have = set(dd for dd, _ in ser)
                key = fbh.norm(x.get('fundBase') or x.get('fund'))
                added = 0
                for row in rows:
                    if key and key in fbh.norm(row.get('name') or ''):
                        fp = row.get('fundPerformanceDetail') or {}
                        pd, pv = fp.get('priceDate'), to_float(fp.get('price'))
                        if pd and pv is not None and pd not in have:
                            ser.append([pd, pv])
                            have.add(pd)
                            added += 1
                        break
                if added:
                    ser.sort(key=lambda t: t[0])
                    o['series'] = ser
                    o['asOf'] = ser[-1][0]
                    o['last'] = ser[-1][1]
                    o['points'] = len(ser)
                    json.dump(o, open(p, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
                    idx['funds'][str(x['id'])] = {'code': x.get('code') or '', 'src': o.get('src', ''),
                                                  'name': o.get('name', ''), 'unit': o.get('unit', ''),
                                                  'scheme': o.get('scheme', ''), 'asOf': o['asOf'],
                                                  'last': o['last'], 'first': o.get('first', ser[0][0]),
                                                  'points': len(ser)}
                    got += added
            time.sleep(SLEEP)
        print('  %s 完成（累计 +%d）' % (fbh.SCHEMES[sid][:14], got), flush=True)

    idx['updatedAt'] = int(time.time() * 1000)
    json.dump(idx, open(idx_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('BCT 近端补抓完成：新增 %d 点，失败 %d 组合' % (got, fail))

if __name__ == '__main__':
    main()
