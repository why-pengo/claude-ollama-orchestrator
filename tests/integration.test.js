// Integration tests for the --dry-run execution path.
// Spawns real node processes to verify acceptance criteria:
// exit 0, correct output, no Ollama call, no log/stats writes.
// Run with: node --test tests/integration.test.js

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'index.js');
const LOG_FILE = join(ROOT, 'orchestrator.log');
const STATS_FILE = join(ROOT, 'orchestrator-stats.json');

function run(...args) {
  return spawnSync('node', [INDEX, ...args], { cwd: ROOT, encoding: 'utf8' });
}

describe('--dry-run: exit code and basic output', () => {
  it('exits 0', () => {
    const { status } = run('--dry-run', 'format this JSON');
    assert.equal(status, 0);
  });

  it('stdout contains [DRY-RUN]', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('[DRY-RUN]'));
  });

  it('stdout contains Route:', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('Route:'));
  });
});

describe('--dry-run: no side effects', () => {
  let logMtimeBefore;

  before(() => {
    logMtimeBefore = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).mtimeMs : null;
  });

  it('does not write to orchestrator.log', () => {
    run('--dry-run', 'format this JSON');
    const logMtimeAfter = fs.existsSync(LOG_FILE) ? fs.statSync(LOG_FILE).mtimeMs : null;
    assert.equal(logMtimeBefore, logMtimeAfter);
  });

  it('stdout contains no [OLLAMA] log line', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(!stdout.includes('[OLLAMA]'));
  });

  it('stdout contains no [ROUTER] log line', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(!stdout.includes('[ROUTER]'));
  });
});

describe('--dry-run: routing decisions', () => {
  it('simple keyword routes simple', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('Route: simple'));
    assert.ok(stdout.includes('"format"'));
  });

  it('medium keyword routes medium', () => {
    const { stdout } = run('--dry-run', 'explain this code');
    assert.ok(stdout.includes('Route: medium'));
    assert.ok(stdout.includes('"explain"'));
  });

  it('--simple flag forces simple regardless of keywords', () => {
    const { stdout } = run('--simple', '--dry-run', 'design an API');
    assert.ok(stdout.includes('Route: simple'));
    assert.ok(stdout.includes('forced via --simple flag'));
  });

  it('--complex flag forces complex regardless of keywords', () => {
    const { stdout } = run('--complex', '--dry-run', 'format this JSON');
    assert.ok(stdout.includes('Route: complex'));
    assert.ok(stdout.includes('forced via --complex flag'));
  });

  it('--dry-run --simple works regardless of flag order', () => {
    const { stdout } = run('--dry-run', '--simple', 'design an API');
    assert.ok(stdout.includes('Route: simple'));
    assert.ok(stdout.includes('forced via --simple flag'));
  });
});

describe('--dry-run: destination line', () => {
  it('shows destination arrow for simple route', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('→'));
    assert.ok(stdout.includes('local Ollama'));
  });

  it('shows Reason line', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('Reason:'));
  });

  it('medium route with no remote shows Claude Code destination', () => {
    const env = { ...process.env };
    delete env.OLLAMA_REMOTE_HOST;
    const { stdout, status } = spawnSync('node', [INDEX, '--dry-run', 'explain this code'], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
    });
    assert.equal(status, 0);
    assert.ok(stdout.includes('Route: medium'));
    assert.ok(stdout.includes('Claude Code'));
  });
});

describe('--dry-run: prompt display', () => {
  it('shows Prompt line', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('Prompt  :'));
  });

  it('shows chars total in prompt line', () => {
    const { stdout } = run('--dry-run', 'format this JSON');
    assert.ok(stdout.includes('chars total'));
  });
});

describe('--stats: estimated savings output', () => {
  // 4,000,000 chars / 4 = 1,000,000 tokens; 1,000,000 / 1M * $3 = $3.00
  const testStats = {
    totalRequests: 12,
    simpleCalls: 8,
    mediumCalls: 2,
    claudeCodeReferrals: 2,
    ollamaFallbacks: 1,
    totalOffloadedChars: 4_000_000,
    routes: [],
  };
  let originalStats;

  before(() => {
    originalStats = fs.existsSync(STATS_FILE) ? fs.readFileSync(STATS_FILE, 'utf8') : null;
    fs.writeFileSync(STATS_FILE, JSON.stringify(testStats));
  });

  after(() => {
    if (originalStats !== null) fs.writeFileSync(STATS_FILE, originalStats);
    else fs.rmSync(STATS_FILE, { force: true });
  });

  it('shows Simple calls line', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('Simple calls'));
  });

  it('shows Medium calls line', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('Medium calls'));
  });

  it('shows Offloaded tokens line', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('Offloaded tokens'));
  });

  it('shows correct token count (1,000,000)', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('1,000,000'));
  });

  it('shows Estimated savings line', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('Estimated savings'));
  });

  it('shows correct savings amount (~$3.00)', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('$3.00'));
  });

  it('labels the pricing rate used', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('$3/M') || stdout.includes('$3.0/M'));
  });

  it('shows correct Total requests count (8+2+2=12)', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('Total requests     : 12'));
  });

  it('shows correct Simple calls percentage (8/12=67%)', () => {
    const { stdout } = run('--stats');
    assert.ok(stdout.includes('67%'));
  });
});
