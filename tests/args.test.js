// Tests for parseArgs() — all flag combinations.
// Run with: node --test tests/args.test.js

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { parseArgs } = require('../index');

describe('parseArgs — force flags', () => {
  it('--simple sets force', () =>
    assert.deepEqual(parseArgs(['--simple', 'do something']), {
      force: 'simple',
      filePath: null,
      promptText: 'do something',
    }));

  it('--complex sets force', () =>
    assert.deepEqual(parseArgs(['--complex', 'design an API']), {
      force: 'complex',
      filePath: null,
      promptText: 'design an API',
    }));

  it('no flag leaves force null', () =>
    assert.deepEqual(parseArgs(['just a prompt']), {
      force: null,
      filePath: null,
      promptText: 'just a prompt',
    }));
});

describe('parseArgs — --file flag', () => {
  it('--file sets filePath and keeps prompt', () =>
    assert.deepEqual(parseArgs(['--file', 'foo.py', 'extract routes']), {
      force: null,
      filePath: 'foo.py',
      promptText: 'extract routes',
    }));

  it('--simple before --file', () =>
    assert.deepEqual(parseArgs(['--simple', '--file', 'foo.py', 'extract routes']), {
      force: 'simple',
      filePath: 'foo.py',
      promptText: 'extract routes',
    }));

  it('--complex before --file', () =>
    assert.deepEqual(parseArgs(['--complex', '--file', 'src/app.py', 'refactor this']), {
      force: 'complex',
      filePath: 'src/app.py',
      promptText: 'refactor this',
    }));

  it('--file mid-args, prompt words joined', () =>
    assert.deepEqual(parseArgs(['summarise', '--file', 'notes.md', 'this file']), {
      force: null,
      filePath: 'notes.md',
      promptText: 'summarise this file',
    }));
});

describe('parseArgs — multi-word prompts', () => {
  it('joins multiple prompt words', () =>
    assert.deepEqual(parseArgs(['convert', 'this', 'csv', 'to', 'json']), {
      force: null,
      filePath: null,
      promptText: 'convert this csv to json',
    }));

  it('empty args produce empty promptText', () =>
    assert.deepEqual(parseArgs([]), {
      force: null,
      filePath: null,
      promptText: '',
    }));
});
