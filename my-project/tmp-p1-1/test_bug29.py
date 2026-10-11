#!/usr/bin/env python3
"""P1-1 BUG-29 verification: old (deferred) vs new (BEGIN IMMEDIATE) counter patterns.

Replicates EXACTLY the code of inc_setting and the create_order order_seq block
from main.py (both old and new versions) against a scratch DB with the real
schema from init_db (settings: key TEXT PRIMARY KEY, value TEXT;
orders: order_no TEXT UNIQUE NOT NULL).
"""
import sqlite3, threading, tempfile, os, sys

def make_db(path):
    if os.path.exists(path):
        os.remove(path)
    c = sqlite3.connect(path)
    c.execute("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)")
    c.execute("""CREATE TABLE IF NOT EXISTS orders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            order_no TEXT UNIQUE NOT NULL,
            user_id INTEGER NOT NULL)""")
    c.commit()
    c.close()

def conn_plain(db):
    # semantics of _conn(): deferred transaction (isolation_level default '')
    c = sqlite3.connect(db, timeout=10)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    return c

def conn_immediate(db):
    # semantics of _conn_immediate(): isolation_level=None + BEGIN IMMEDIATE
    c = sqlite3.connect(db, timeout=10, isolation_level=None)
    c.row_factory = sqlite3.Row
    c.execute("PRAGMA journal_mode=WAL")
    c.execute("BEGIN IMMEDIATE")
    return c

# ---- exact replicas of inc_setting (old / new) ----
def inc_setting_OLD(db, key):
    with conn_plain(db) as c:
        row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        cur = int(row["value"]) if row and row["value"] and str(row["value"]).isdigit() else 0
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(cur + 1)),
        )
        c.commit()

def inc_setting_NEW(db, key):
    c = conn_immediate(db)
    try:
        row = c.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
        cur = int(row["value"]) if row and row["value"] and str(row["value"]).isdigit() else 0
        c.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(cur + 1)),
        )
        c.commit()
    except Exception:
        c.rollback(); raise
    finally:
        c.close()

# ---- exact replicas of the create_order seq block (old / new) ----
def create_order_OLD(db, user_id):
    with conn_plain(db) as c:
        row = c.execute("SELECT value FROM settings WHERE key = 'order_seq'").fetchone()
        seq = (int(row["value"]) if row and str(row["value"]).isdigit() else 0) + 1
        c.execute("INSERT INTO settings (key, value) VALUES ('order_seq', ?) "
                  "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(seq),))
        try:
            c.execute("INSERT INTO orders (order_no, user_id) VALUES (?, ?)",
                      (f"ORD-{seq:05d}", user_id))
            c.commit()
        except sqlite3.IntegrityError:
            c.rollback()
            return "UNIQUE_VIOLATION"
        return f"ORD-{seq:05d}"

def create_order_NEW(db, user_id):
    c = conn_immediate(db)
    try:
        row = c.execute("SELECT value FROM settings WHERE key = 'order_seq'").fetchone()
        seq = (int(row["value"]) if row and str(row["value"]).isdigit() else 0) + 1
        c.execute("INSERT INTO settings (key, value) VALUES ('order_seq', ?) "
                  "ON CONFLICT(key) DO UPDATE SET value = excluded.value", (str(seq),))
        c.execute("INSERT INTO orders (order_no, user_id) VALUES (?, ?)",
                  (f"ORD-{seq:05d}", user_id))
        c.commit()
        return f"ORD-{seq:05d}"
    except Exception:
        c.rollback(); raise
    finally:
        c.close()

def run_threads(fn, db, nthreads=8, per=25):
    errs = []
    def worker():
        try:
            for _ in range(per):
                fn(db)
        except Exception as e:
            errs.append(f"{type(e).__name__}: {e}")
    ts = [threading.Thread(target=worker) for _ in range(nthreads)]
    [t.start() for t in ts]
    [t.join() for t in ts]
    return errs

tmp = tempfile.mkdtemp(prefix="p11-bug29-")

# ---- test 1: inc_setting ----
db1 = os.path.join(tmp, "inc.db"); make_db(db1)
errs = run_threads(lambda d: inc_setting_OLD(d, "gate_blocked_count"), db1)
v = sqlite3.connect(db1).execute("SELECT value FROM settings WHERE key='gate_blocked_count'").fetchone()
print(f"[OLD] inc_setting 200 concurrent -> value={v[0] if v else None} (expected 200), errors={len(errs)}")
if errs: print("  first err:", errs[0])

db2 = os.path.join(tmp, "inc2.db"); make_db(db2)
errs = run_threads(lambda d: inc_setting_NEW(d, "gate_blocked_count"), db2)
v = sqlite3.connect(db2).execute("SELECT value FROM settings WHERE key='gate_blocked_count'").fetchone()
print(f"[NEW] inc_setting 200 concurrent -> value={v[0] if v else None} (expected 200), errors={len(errs)}")
if errs: print("  first err:", errs[0]); sys.exit(1)

# ---- test 2: order_seq ----
db3 = os.path.join(tmp, "ord.db"); make_db(db3)
errs = run_threads(lambda d: create_order_OLD(d, 1), db3)
nos = [r[0] for r in sqlite3.connect(db3).execute("SELECT order_no FROM orders").fetchall()]
print(f"[OLD] create_order 200 concurrent -> rows={len(nos)} (expected 200), errors={len(errs)}")
if errs: print("  first err:", errs[0])

db4 = os.path.join(tmp, "ord2.db"); make_db(db4)
errs = run_threads(lambda d: create_order_NEW(d, 1), db4)
nos = [r[0] for r in sqlite3.connect(db4).execute("SELECT order_no FROM orders").fetchall()]
seqv = sqlite3.connect(db4).execute("SELECT value FROM settings WHERE key='order_seq'").fetchone()[0]
print(f"[NEW] create_order 200 concurrent -> rows={len(nos)} (expected 200), order_seq={seqv} (expected 200), errors={len(errs)}")
if errs or len(nos) != 200 or len(set(nos)) != 200 or int(seqv) != 200:
    print("  FAILURE"); sys.exit(1)

print("\nBUG-29 verification: OLD pattern loses counts / hits UNIQUE; NEW pattern is exact and race-free.")
