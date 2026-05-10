// stats-db.js — per-request SQLite store for time-series routing data.
// better-sqlite3 is synchronous; no async plumbing needed.
//
// Why eager init: better-sqlite3 loads its native addon via require('bindings')
// inside the Database constructor, which goes through the CJS loader and calls
// fs.readFileSync. Test suites that stub readFileSync must have the addon loaded
// before that stub is applied — so we call new Database() at module-import time.
//
// STATS_DB_PATH env var: set to ':memory:' (or a temp path) to avoid creating
// a file on disk — useful for tests and dry-run flows.

import Database from 'better-sqlite3';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DB_FILE = join(__dirname, 'orchestrator-stats.db');

const _db = new Database(process.env.STATS_DB_PATH ?? DEFAULT_DB_FILE);
_db.pragma('journal_mode = WAL');
_db.exec(`
  CREATE TABLE IF NOT EXISTS requests (
    id    INTEGER PRIMARY KEY,
    ts    INTEGER NOT NULL,
    route TEXT    NOT NULL,
    ms    INTEGER,
    chars INTEGER,
    model TEXT,
    label TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ts          ON requests(ts);
  CREATE INDEX IF NOT EXISTS idx_route       ON requests(route);
  CREATE INDEX IF NOT EXISTS idx_route_label ON requests(route, label);
`);

const _insertStmt = _db.prepare(
  'INSERT INTO requests (ts, route, ms, chars, model, label) VALUES (?, ?, ?, ?, ?, ?)',
);

export function insertRequest({ ts, route, ms = null, chars = null, model = null, label = null }) {
  _insertStmt.run(ts ?? Date.now(), route, ms ?? null, chars ?? null, model ?? null, label ?? null);
}

// Seeds the DB from an existing routes[] array (runs once; skipped if DB already has rows).
export function migrateFromRoutes(routes) {
  if (!routes?.length) return;
  if (_db.prepare('SELECT COUNT(*) as n FROM requests').get().n > 0) return;

  const insert = _db.prepare(
    'INSERT INTO requests (ts, route, ms, chars, model, label) VALUES (?, ?, ?, ?, ?, ?)',
  );
  _db.transaction(() => {
    for (const r of routes) {
      const raw = typeof r.ts === 'string' ? new Date(r.ts).getTime() : (r.ts ?? Date.now());
      const ts = Number.isFinite(raw) ? raw : Date.now();
      insert.run(ts, r.route, r.ms ?? null, null, r.model ?? null, r.label ?? null);
    }
  })();
}

export function getAvgMs(route) {
  const row = _db
    .prepare('SELECT AVG(ms) as avg FROM requests WHERE route = ? AND ms > 0')
    .get(route);
  return row?.avg != null ? Math.round(row.avg) : null;
}

export function getFallbackCounts() {
  const rows = _db
    .prepare(
      "SELECT label, COUNT(*) as count FROM requests WHERE route = 'ollama-fallback' AND label IS NOT NULL GROUP BY label",
    )
    .all();
  return rows.reduce((acc, r) => {
    acc[r.label] = r.count;
    return acc;
  }, {});
}

export function getTallies() {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(todayStart);
  weekStart.setDate(todayStart.getDate() - todayStart.getDay());
  const monthStart = new Date(todayStart.getFullYear(), todayStart.getMonth(), 1);

  const q = _db.prepare(
    "SELECT route, COUNT(*) as count FROM requests WHERE ts >= ? AND route NOT IN ('ollama-fallback') GROUP BY route",
  );

  const toMap = (rows) => Object.fromEntries(rows.map((r) => [r.route, r.count]));

  return {
    today: toMap(q.all(todayStart.getTime())),
    week: toMap(q.all(weekStart.getTime())),
    month: toMap(q.all(monthStart.getTime())),
  };
}

export function getRecentRoutes(n = 5) {
  return _db.prepare('SELECT ts, route, ms, model FROM requests ORDER BY ts DESC LIMIT ?').all(n);
}

export function resetDb() {
  _db.exec('DELETE FROM requests');
}
