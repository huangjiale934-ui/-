# -*- coding: utf-8 -*-
"""hist-index.json 的并发安全写入（2026-11-05 第三十九轮）

背景：早间/晚间链路里十来个抓取脚本各自「读索引 → 抓取 → 整份覆盖写回」。
串行跑没问题；一旦并行（为了提速），就会出现两类故障：
  ① 丢失条目：后写盘的脚本用自己启动时的旧快照覆盖了别人新增的基金；
  ② 读到半截文件：写盘过程中另一个脚本 json.load 失败，该步骤直接挂掉。

这里提供两个函数：
  load(path)                  读索引（带重试，坏文件不抛异常，返回空字典兜底）
  merge_save(path, funds)     加锁 → 重新读盘 → 合并（本次条目优先）→ 原子替换

锁：Windows 用 msvcrt.locking，POSIX（GitHub Actions）用 fcntl.flock。
原子：写 <path>.tmp.<pid> 后 os.replace，读到的永远是完整文件。
"""
import json
import os
import sys
import time

try:                                    # Windows
    import msvcrt
except ImportError:                     # POSIX
    msvcrt = None
    try:
        import fcntl
    except ImportError:
        fcntl = None


def _lock_path(path):
    return path + ".lock"


class _FileLock(object):
    def __init__(self, path, timeout=20.0):
        self.fp = None
        self.path = _lock_path(path)
        self.timeout = timeout

    def __enter__(self):
        self.fp = open(self.path, "a+b")
        deadline = time.time() + self.timeout
        while True:
            try:
                if msvcrt is not None:
                    self.fp.seek(0)
                    msvcrt.locking(self.fp.fileno(), msvcrt.LK_NBLCK, 1)
                elif fcntl is not None:
                    fcntl.flock(self.fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except OSError:
                if time.time() > deadline:
                    # 拿不到锁也不阻塞链路：继续执行（合并逻辑仍然幂等）
                    sys.stderr.write("[histidx] 取锁超时，继续执行（%s）\n" % self.path)
                    return self
                time.sleep(0.05)

    def __exit__(self, *exc):
        try:
            if msvcrt is not None:
                self.fp.seek(0)
                msvcrt.locking(self.fp.fileno(), msvcrt.LK_UNLCK, 1)
            elif fcntl is not None:
                fcntl.flock(self.fp.fileno(), fcntl.LOCK_UN)
        except Exception:               # noqa: BLE001
            pass
        try:
            self.fp.close()
        except Exception:               # noqa: BLE001
            pass
        return False


def load(path):
    """读 hist-index.json 的 funds 字典；文件坏掉时返回 {}（不抛异常）。"""
    for i in range(5):
        try:
            with open(path, encoding="utf-8") as fh:
                return (json.load(fh) or {}).get("funds", {}) or {}
        except (ValueError, OSError):
            time.sleep(0.1 * (i + 1))
    sys.stderr.write("[histidx] 索引读取失败，按空索引继续：%s\n" % path)
    return {}


def merge_save(path, funds, source=None):
    """把本次抓到的条目并入索引并原子落盘，返回合并后的总条数。"""
    with _FileLock(path):
        old = load(path)
        merged = dict(old)
        for k, v in (funds or {}).items():
            cur = merged.get(k)
            if isinstance(cur, dict) and isinstance(v, dict):
                row = dict(cur)
                row.update(v)           # 本次写入的字段优先
                merged[k] = row
            else:
                merged[k] = v
        meta = {}
        try:
            with open(path, encoding="utf-8") as fh:
                meta = json.load(fh) or {}
        except Exception:               # noqa: BLE001
            meta = {}
        meta.pop("funds", None)
        meta["updatedAt"] = int(time.time() * 1000)
        if source:
            meta["source"] = source
        meta["count"] = len(merged)
        meta["funds"] = merged
        tmp = "%s.tmp.%d" % (path, os.getpid())
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(meta, fh, ensure_ascii=False, separators=(",", ":"))
        os.replace(tmp, path)
        return len(merged)
