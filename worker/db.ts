/**
 * Storage layer. The production database is the SQLite built into a Cloudflare
 * Durable Object; tests use bun:sqlite. Both speak the same SQL, behind this tiny interface.
 */

export type Param = string | number | null;
export type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, ...params: Param[]): T[];
  one<T = Row>(sql: string, ...params: Param[]): T | null;
  run(sql: string, ...params: Param[]): void;
  /** Runs `fn` atomically: either all of its writes happen or none. */
  tx<T>(fn: () => T): T;
}

export function durableObjectDb(state: DurableObjectState): Db {
  const sql = state.storage.sql;
  return {
    all: <T = Row>(q: string, ...p: Param[]) => sql.exec(q, ...p).toArray() as unknown as T[],
    one: <T = Row>(q: string, ...p: Param[]) => {
      const rows = sql.exec(q, ...p).toArray() as unknown as T[];
      return rows.length ? (rows[0] as T) : null;
    },
    run: (q: string, ...p: Param[]) => {
      sql.exec(q, ...p);
    },
    tx: <T>(fn: () => T) => state.storage.transactionSync(fn),
  };
}

const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,

  `CREATE TABLE IF NOT EXISTS users (
     uid TEXT PRIMARY KEY,
     email TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL,
     last_seen_at TEXT NOT NULL
   )`,

  // One row per client MT5 account.
  // status: requested -> approved -> connecting -> ready -> active  (paused | error | blocked | removed)
  `CREATE TABLE IF NOT EXISTS accounts (
     id TEXT PRIMARY KEY,
     uid TEXT NOT NULL,
     login TEXT NOT NULL,
     server TEXT NOT NULL,
     label TEXT NOT NULL DEFAULT '',
     status TEXT NOT NULL,
     status_reason TEXT NOT NULL DEFAULT '',
     metaapi_id TEXT,
     region TEXT,
     tx_id TEXT,
     margin_mode TEXT,
     currency TEXT,
     balance REAL,
     equity REAL,
     snapshot_at TEXT,
     symbol_mapping TEXT,
     cum_pnl REAL NOT NULL DEFAULT 0,
     hwm REAL NOT NULL DEFAULT 0,
     deals_synced_to TEXT,
     started_at TEXT,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   )`,
  // The same MT5 login on the same server can only be linked once at a time.
  `CREATE UNIQUE INDEX IF NOT EXISTS accounts_login_server
     ON accounts(login, server) WHERE status <> 'removed'`,
  `CREATE INDEX IF NOT EXISTS accounts_uid ON accounts(uid)`,

  `CREATE TABLE IF NOT EXISTS deals (
     account_id TEXT NOT NULL,
     deal_id TEXT NOT NULL,
     time TEXT NOT NULL,
     type TEXT NOT NULL,
     entry TEXT,
     symbol TEXT,
     volume REAL,
     pnl_usd REAL NOT NULL,
     PRIMARY KEY (account_id, deal_id)
   )`,

  // status: draft -> issued -> paid   (or void)
  `CREATE TABLE IF NOT EXISTS invoices (
     id TEXT PRIMARY KEY,
     account_id TEXT NOT NULL,
     uid TEXT NOT NULL,
     status TEXT NOT NULL,
     period_start TEXT NOT NULL,
     period_end TEXT NOT NULL,
     cum_pnl REAL NOT NULL,
     hwm_before REAL NOT NULL,
     hwm_after REAL NOT NULL,
     fee_rate REAL NOT NULL,
     amount REAL NOT NULL,
     created_at TEXT NOT NULL,
     issued_at TEXT,
     paid_at TEXT,
     note TEXT NOT NULL DEFAULT ''
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS invoices_one_draft ON invoices(account_id) WHERE status = 'draft'`,
  `CREATE INDEX IF NOT EXISTS invoices_uid ON invoices(uid)`,

  // status: submitted -> confirmed | rejected. A transaction id can only ever be used once.
  `CREATE TABLE IF NOT EXISTS payments (
     tx_hash TEXT PRIMARY KEY,
     invoice_id TEXT NOT NULL,
     uid TEXT NOT NULL,
     status TEXT NOT NULL,
     created_at TEXT NOT NULL,
     decided_at TEXT,
     decided_by TEXT,
     note TEXT NOT NULL DEFAULT ''
   )`,

  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     ts TEXT NOT NULL,
     actor TEXT NOT NULL,
     action TEXT NOT NULL,
     target TEXT,
     detail TEXT
   )`,
];

export const SCHEMA_VERSION = '1';

export function ensureSchema(db: Db): void {
  for (const stmt of SCHEMA) db.run(stmt);
  db.run(`INSERT INTO meta(key, value) VALUES('schema_version', ?) ON CONFLICT(key) DO NOTHING`, SCHEMA_VERSION);
}

// ---------- settings ----------

export interface Settings {
  feeRate: number; // 0..1, the platform's share of new profit
  treasuryAddress: string; // TRON address clients pay to ('' until set)
  minInvoice: number; // USDT
  graceDays: number; // days an invoice may stay unpaid before copying is paused
  maxActiveAccounts: number; // cost guard: simultaneous accounts on the copying service
  maxAccountsPerUser: number;
  strategyId: string; // CopyFactory strategy id ('' until master is set up)
  masterMetaapiId: string;
  region: string; // MetaApi region used for new accounts
  scalingMode: 'balance' | 'equity';
  dailyLossLimitPct: number; // 0 = off
}

export const DEFAULT_SETTINGS: Settings = {
  feeRate: 0.5,
  treasuryAddress: '',
  minInvoice: 5,
  graceDays: 3,
  maxActiveAccounts: 5,
  maxAccountsPerUser: 3,
  strategyId: '',
  masterMetaapiId: '',
  region: '',
  scalingMode: 'balance',
  dailyLossLimitPct: 0,
};

export function loadSettings(db: Db, fallbackRegion: string): Settings {
  const out: Record<string, unknown> = { ...DEFAULT_SETTINGS, region: fallbackRegion };
  for (const row of db.all<{ key: string; value: string }>(`SELECT key, value FROM settings`)) {
    if (!(row.key in DEFAULT_SETTINGS)) continue;
    try {
      out[row.key] = JSON.parse(row.value);
    } catch {
      /* ignore malformed value, keep default */
    }
  }
  return out as unknown as Settings;
}

export function saveSetting(db: Db, key: keyof Settings, value: unknown): void {
  db.run(
    `INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    JSON.stringify(value),
  );
}

export function audit(db: Db, now: Date, actor: string, action: string, target: string | null, detail?: unknown): void {
  db.run(
    `INSERT INTO audit(ts, actor, action, target, detail) VALUES(?, ?, ?, ?, ?)`,
    now.toISOString(),
    actor,
    action,
    target,
    detail === undefined ? null : JSON.stringify(detail),
  );
}
