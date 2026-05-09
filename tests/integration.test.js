// Integration tests for the --dry-run execution path.
// Spawns real node processes to verify acceptance criteria:
// exit 0, correct output, no Ollama call, no log/stats writes.
// Run with: node --test tests/integration.test.js

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const INDEX = join(ROOT, 'index.js');
const LOG_FILE = join(ROOT, 'orchestrator.log');

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

  it('complex keyword routes complex', () => {
    const { stdout } = run('--dry-run', 'refactor this function');
    assert.ok(stdout.includes('Route: complex'));
    assert.ok(stdout.includes('"refactor"'));
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
