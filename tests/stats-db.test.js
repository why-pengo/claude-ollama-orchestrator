// Tests for stats-db.js — SQLite time-series store.
// stats-db.js opens the Database eagerly at module scope, so STATS_DB_PATH
// must be set before the module is first imported. Static ESM imports are
// hoisted ahead of any module-body statements, so we use a dynamic import
// here to guarantee the env var is set first.
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

process.env.STATS_DB_PATH = ':memory:';

const {
  insertRequest,
  migrateFromRoutes,
  getAvgMs,
  getFallbackCounts,
  getTallies,
  getRecentRoutes,
  resetDb,
} = await import('../stats-db.js');

// ── insertRequest / getRecentRoutes ───────────────────────────────────────────
describe('insertRequest / getRecentRoutes', () => {
  beforeEach(() => resetDb());

  it('inserts a row and returns it', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 100, chars: 50, model: 'mistral' });
    const rows = getRecentRoutes(1);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].route, 'ollama');
    assert.equal(rows[0].ms, 100);
  });

  it('returns most recent first', () => {
    insertRequest({ ts: 1000, route: 'ollama', ms: 10 });
    insertRequest({ ts: 2000, route: 'claude-code', ms: 0 });
    const [first, second] = getRecentRoutes(2);
    assert.equal(first.route, 'claude-code');
    assert.equal(second.route, 'ollama');
  });

  it('respects the limit', () => {
    for (let i = 0; i < 10; i++) insertRequest({ ts: Date.now() + i, route: 'ollama', ms: i });
    assert.equal(getRecentRoutes(3).length, 3);
  });
});

// ── getAvgMs ─────────────────────────────────────────────────────────────────
describe('getAvgMs', () => {
  beforeEach(() => resetDb());

  it('returns null when no rows exist', () => {
    assert.equal(getAvgMs('ollama'), null);
  });

  it('computes average ms for a route', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 100 });
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 200 });
    assert.equal(getAvgMs('ollama'), 150);
  });

  it('excludes ms = 0 and null', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 0 });
    insertRequest({ ts: Date.now(), route: 'ollama', ms: null });
    assert.equal(getAvgMs('ollama'), null);
  });

  it('does not cross-contaminate routes', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 100 });
    insertRequest({ ts: Date.now(), route: 'ollama-remote', ms: 500 });
    assert.equal(getAvgMs('ollama'), 100);
    assert.equal(getAvgMs('ollama-remote'), 500);
  });
});

// ── getFallbackCounts ─────────────────────────────────────────────────────────
describe('getFallbackCounts', () => {
  beforeEach(() => resetDb());

  it('returns empty object when no fallbacks', () => {
    assert.deepEqual(getFallbackCounts(), {});
  });

  it('counts fallbacks grouped by label', () => {
    insertRequest({ ts: Date.now(), route: 'ollama-fallback', label: 'OLLAMA-DOWN' });
    insertRequest({ ts: Date.now(), route: 'ollama-fallback', label: 'OLLAMA-DOWN' });
    insertRequest({ ts: Date.now(), route: 'ollama-fallback', label: 'OLLAMA-TIMEOUT' });
    const fb = getFallbackCounts();
    assert.equal(fb['OLLAMA-DOWN'], 2);
    assert.equal(fb['OLLAMA-TIMEOUT'], 1);
    assert.equal(fb['OLLAMA-ERROR'], undefined);
  });

  it('ignores fallback rows with null label', () => {
    insertRequest({ ts: Date.now(), route: 'ollama-fallback', label: null });
    assert.deepEqual(getFallbackCounts(), {});
  });
});

// ── getTallies — period boundaries ────────────────────────────────────────────
describe('getTallies', () => {
  beforeEach(() => resetDb());

  it('returns empty maps when DB is empty', () => {
    const { today, week, month } = getTallies();
    assert.deepEqual(today, {});
    assert.deepEqual(week, {});
    assert.deepEqual(month, {});
  });

  it('counts a request made today', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 100 });
    const { today } = getTallies();
    assert.equal(today['ollama'], 1);
  });

  it('excludes a request from yesterday from today tally', () => {
    const yesterday = Date.now() - 25 * 60 * 60 * 1000;
    insertRequest({ ts: yesterday, route: 'ollama', ms: 100 });
    const { today } = getTallies();
    assert.equal(today['ollama'], undefined);
  });

  it('includes a request from the start of this week in the week tally', () => {
    // Compute the same weekStart that getTallies() uses so the test is day-of-week agnostic.
    const weekStart = new Date();
    weekStart.setHours(0, 0, 0, 0);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    insertRequest({ ts: weekStart.getTime() + 1000, route: 'ollama-remote', ms: 200 });
    const { week } = getTallies();
    assert.equal(week['ollama-remote'], 1);
  });

  it('excludes ollama-fallback from all tallies', () => {
    insertRequest({ ts: Date.now(), route: 'ollama-fallback', label: 'OLLAMA-DOWN' });
    const { today, week, month } = getTallies();
    assert.equal(today['ollama-fallback'], undefined);
    assert.equal(week['ollama-fallback'], undefined);
    assert.equal(month['ollama-fallback'], undefined);
  });

  it('tallies multiple routes independently', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 50 });
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 60 });
    insertRequest({ ts: Date.now(), route: 'claude-code', ms: 0 });
    const { today } = getTallies();
    assert.equal(today['ollama'], 2);
    assert.equal(today['claude-code'], 1);
  });
});

// ── migrateFromRoutes ─────────────────────────────────────────────────────────
describe('migrateFromRoutes', () => {
  beforeEach(() => resetDb());

  it('seeds DB from a legacy routes array', () => {
    migrateFromRoutes([
      { ts: '2026-01-01T00:00:00.000Z', route: 'ollama', ms: 100 },
      { ts: '2026-01-02T00:00:00.000Z', route: 'claude-code', ms: 0 },
    ]);
    assert.equal(getRecentRoutes(10).length, 2);
  });

  it('skips migration when DB already has rows', () => {
    insertRequest({ ts: Date.now(), route: 'ollama', ms: 50 });
    migrateFromRoutes([{ ts: '2026-01-01T00:00:00.000Z', route: 'claude-code', ms: 0 }]);
    assert.equal(getRecentRoutes(10).length, 1);
  });

  it('replaces invalid date strings with Date.now() rather than NaN', () => {
    migrateFromRoutes([{ ts: 'not-a-date', route: 'ollama', ms: 10 }]);
    const [row] = getRecentRoutes(1);
    assert.ok(Number.isFinite(row.ts), `expected finite ts, got ${row.ts}`);
  });

  it('is a no-op for an empty array', () => {
    migrateFromRoutes([]);
    assert.equal(getRecentRoutes(10).length, 0);
  });

  it('is a no-op for null', () => {
    migrateFromRoutes(null);
    assert.equal(getRecentRoutes(10).length, 0);
  });
});
