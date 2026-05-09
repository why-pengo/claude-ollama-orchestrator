// Tests for parseArgs() — all flag combinations.
// Run with: node --test tests/args.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseArgs } from '../index.js';

describe('parseArgs — force flags', () => {
  it('--simple sets force', () =>
    assert.deepEqual(parseArgs(['--simple', 'do something']), {
      force: 'simple',
      filePath: null,
      promptText: 'do something',
      dryRun: false,
    }));

  it('--complex sets force', () =>
    assert.deepEqual(parseArgs(['--complex', 'design an API']), {
      force: 'complex',
      filePath: null,
      promptText: 'design an API',
      dryRun: false,
    }));

  it('no flag leaves force null', () =>
    assert.deepEqual(parseArgs(['just a prompt']), {
      force: null,
      filePath: null,
      promptText: 'just a prompt',
      dryRun: false,
    }));
});

describe('parseArgs — --file flag', () => {
  it('--file sets filePath and keeps prompt', () =>
    assert.deepEqual(parseArgs(['--file', 'foo.py', 'extract routes']), {
      force: null,
      filePath: 'foo.py',
      promptText: 'extract routes',
      dryRun: false,
    }));

  it('--simple before --file', () =>
    assert.deepEqual(parseArgs(['--simple', '--file', 'foo.py', 'extract routes']), {
      force: 'simple',
      filePath: 'foo.py',
      promptText: 'extract routes',
      dryRun: false,
    }));

  it('--complex before --file', () =>
    assert.deepEqual(parseArgs(['--complex', '--file', 'src/app.py', 'refactor this']), {
      force: 'complex',
      filePath: 'src/app.py',
      promptText: 'refactor this',
      dryRun: false,
    }));

  it('--file mid-args, prompt words joined', () =>
    assert.deepEqual(parseArgs(['summarise', '--file', 'notes.md', 'this file']), {
      force: null,
      filePath: 'notes.md',
      promptText: 'summarise this file',
      dryRun: false,
    }));
});

describe('parseArgs — multi-word prompts', () => {
  it('joins multiple prompt words', () =>
    assert.deepEqual(parseArgs(['convert', 'this', 'csv', 'to', 'json']), {
      force: null,
      filePath: null,
      promptText: 'convert this csv to json',
      dryRun: false,
    }));

  it('empty args produce empty promptText', () =>
    assert.deepEqual(parseArgs([]), {
      force: null,
      filePath: null,
      promptText: '',
      dryRun: false,
    }));
});

describe('parseArgs — --dry-run flag', () => {
  it('sets dryRun true', () =>
    assert.deepEqual(parseArgs(['--dry-run', 'format this']), {
      force: null,
      filePath: null,
      promptText: 'format this',
      dryRun: true,
    }));

  it('--simple --dry-run (simple first)', () =>
    assert.deepEqual(parseArgs(['--simple', '--dry-run', 'format this']), {
      force: 'simple',
      filePath: null,
      promptText: 'format this',
      dryRun: true,
    }));

  it('--dry-run --simple (dry-run first)', () =>
    assert.deepEqual(parseArgs(['--dry-run', '--simple', 'format this']), {
      force: 'simple',
      filePath: null,
      promptText: 'format this',
      dryRun: true,
    }));

  it('--dry-run with --file', () =>
    assert.deepEqual(parseArgs(['--dry-run', '--file', 'src/app.py', 'extract routes']), {
      force: null,
      filePath: 'src/app.py',
      promptText: 'extract routes',
      dryRun: true,
    }));

  it('no --dry-run leaves dryRun false', () =>
    assert.deepEqual(parseArgs(['format this']), {
      force: null,
      filePath: null,
      promptText: 'format this',
      dryRun: false,
    }));
});
