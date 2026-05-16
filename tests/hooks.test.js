// Tests for the hook integration points: parseHookPayload (stdin JSON sanitiser)
// and classifyPrompt (standalone pure classifier used by the UserPromptSubmit hook).
// Run with: node --test tests/hooks.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import fs from 'node:fs';
import { classifyPrompt } from '../classifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const INDEX = join(__dirname, '..', 'index.js');
const TMP_LOG = join(tmpdir(), `orchestrator-hooks-test-${process.pid}.log`);
const TMP_STATS = join(tmpdir(), `orchestrator-hooks-test-${process.pid}.json`);

// Spawn `node index.js <flag>` with the given stdin payload and capture stdout/stderr.
// Env overrides keep the real DB, stats file, and log file untouched during tests.
function runCli(flag, stdin) {
  return spawnSync('node', [INDEX, flag], {
    input: stdin,
    encoding: 'utf8',
    env: {
      ...process.env,
      STATS_DB_PATH: ':memory:',
      STATS_FILE_PATH: TMP_STATS,
      LOG_FILE_PATH: TMP_LOG,
    },
  });
}

describe('classifyPrompt — standalone classifier (no TaskRouter)', () => {
  it('returns simple for extract', () => {
    const { complexity, reason } = classifyPrompt('extract the route paths');
    assert.equal(complexity, 'simple');
    assert.match(reason, /"extract"/);
  });

  it('returns complex for debug', () => {
    const { complexity, reason } = classifyPrompt('debug this TypeError');
    assert.equal(complexity, 'complex');
    assert.match(reason, /"debug"/);
  });

  it('returns medium for explain', () => {
    const { complexity } = classifyPrompt('explain how this works');
    assert.equal(complexity, 'medium');
  });

  it('falls back to simple for short non-keyword prompts', () => {
    const { complexity, reason } = classifyPrompt('yes');
    assert.equal(complexity, 'simple');
    assert.match(reason, /length fallback/);
  });

  it('falls back to complex for long non-keyword prompts', () => {
    const { complexity } = classifyPrompt('hi '.repeat(300));
    assert.equal(complexity, 'complex');
  });

  it('coerces non-string input without throwing', () => {
    // Hook payloads come from external input — a null/number/object prompt must not crash.
    for (const bad of [null, undefined, 42, { not: 'a string' }, true]) {
      assert.doesNotThrow(() => classifyPrompt(bad));
    }
  });
});

describe('parseHookPayload — control character handling', () => {
  it('parses well-formed JSON normally', () => {
    const r = runCli('--classify', '{"session_id":"abc","prompt":"extract values","cwd":"/tmp"}');
    assert.equal(r.status, 0);
  });

  it('recovers from unescaped tab in prompt field', () => {
    // Literal tab inside a JSON string is invalid; the parser should retry with it escaped.
    const r = runCli('--classify', '{"prompt":"extract\tvalues","cwd":"/tmp"}');
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  it('recovers from unescaped newline in prompt field', () => {
    const r = runCli('--classify', '{"prompt":"extract\nvalues","cwd":"/tmp"}');
    assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  });

  it('emits a WARN on truly unparseable input but does not crash', () => {
    const r = runCli('--classify', 'not-json-at-all');
    assert.equal(r.status, 0);
  });
});

describe('--classify and --track skip when cwd is the orchestrator repo', () => {
  const orchDir = join(__dirname, '..');
  const clearLog = () => {
    try {
      fs.writeFileSync(TMP_LOG, '');
    } catch {
      // file doesn't exist yet — nothing to clear
    }
  };

  it('--classify exits silently when cwd matches ORCH_DIR', () => {
    clearLog();
    const r = runCli(
      '--classify',
      JSON.stringify({ session_id: 'abc', prompt: 'extract values', cwd: orchDir }),
    );
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', `unexpected stdout: ${r.stdout}`);
    const logContent = fs.existsSync(TMP_LOG) ? fs.readFileSync(TMP_LOG, 'utf8') : '';
    assert.ok(!logContent.includes('[CLASSIFY]'), `unexpected log entry: ${logContent}`);
  });

  it('--track exits silently when cwd matches ORCH_DIR', () => {
    clearLog();
    const r = runCli('--track', JSON.stringify({ session_id: 'abc', cwd: orchDir }));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '', `unexpected stdout: ${r.stdout}`);
  });

  it('--classify writes [CLASSIFY] to the log file (not stdout) when cwd differs', () => {
    clearLog();
    const r = runCli(
      '--classify',
      JSON.stringify({ session_id: 'abc', prompt: 'extract values', cwd: '/tmp/other-repo' }),
    );
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('[CLASSIFY]'), `[CLASSIFY] leaked to stdout: ${r.stdout}`);
    const logContent = fs.readFileSync(TMP_LOG, 'utf8');
    assert.ok(logContent.includes('[CLASSIFY]'), `expected [CLASSIFY] in log: ${logContent}`);
  });
});

describe('--classify additionalContext nudge', () => {
  const cwd = '/tmp/other-repo';

  it('emits an [orchestrator] hint for keyword-matched simple prompts', () => {
    const r = runCli('--classify', JSON.stringify({ prompt: 'extract route paths', cwd }));
    assert.equal(r.status, 0);
    assert.ok(
      r.stdout.includes('[orchestrator]'),
      `expected orchestrator hint in stdout: ${r.stdout}`,
    );
    assert.ok(r.stdout.includes('--simple'), `expected --simple flag in hint: ${r.stdout}`);
    assert.ok(r.stdout.includes('kw="extract"'), `expected kw="extract" in hint: ${r.stdout}`);
  });

  it('emits an [orchestrator] hint for keyword-matched medium prompts (no --simple flag)', () => {
    const r = runCli('--classify', JSON.stringify({ prompt: 'explain how this works', cwd }));
    assert.equal(r.status, 0);
    assert.ok(r.stdout.includes('[orchestrator]'), `expected hint: ${r.stdout}`);
    assert.ok(!r.stdout.includes('--simple'), `--simple should not appear for medium: ${r.stdout}`);
    assert.ok(r.stdout.includes('kw="explain"'), `expected kw="explain": ${r.stdout}`);
  });

  it('stays silent (no hint) for length-fallback prompts', () => {
    const r = runCli('--classify', JSON.stringify({ prompt: 'work on issue 14', cwd }));
    assert.equal(r.status, 0);
    assert.ok(!r.stdout.includes('[orchestrator]'), `unexpected hint: ${r.stdout}`);
  });

  it('stays silent (no hint) for keyword-matched complex prompts', () => {
    const r = runCli('--classify', JSON.stringify({ prompt: 'refactor the auth module', cwd }));
    assert.equal(r.status, 0);
    assert.ok(
      !r.stdout.includes('[orchestrator]'),
      `complex prompts should not be nudged: ${r.stdout}`,
    );
  });
});
