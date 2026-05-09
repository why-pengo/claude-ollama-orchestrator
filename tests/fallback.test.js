// Tests for Ollama error fallback paths.
// Mocks globalThis.fetch to simulate ECONNREFUSED, ETIMEDOUT, and HTTP non-200.
// Stubs fs I/O so tests leave no log or stats files behind.
// Run with: node --test tests/fallback.test.js

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const TaskRouter = require('../ollama-router');

function stubFs() {
  mock.method(fs, 'appendFileSync', () => {});
  mock.method(fs, 'writeFileSync', () => {});
  mock.method(fs, 'readFileSync', () => {
    throw new Error('no stats');
  });
}

describe('Ollama fallback — ECONNREFUSED', () => {
  let router;
  let savedFetch;

  beforeEach(() => {
    stubFs();
    router = new TaskRouter();
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ECONNREFUSED' };
      throw err;
    };
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    mock.restoreAll();
  });

  it('returns ollama-fallback source', async () => {
    const result = await router.callOllama('Format this JSON');
    assert.equal(result.source, 'ollama-fallback');
  });

  it('sets label to OLLAMA-DOWN', async () => {
    const result = await router.callOllama('Format this JSON');
    assert.equal(result.label, 'OLLAMA-DOWN');
  });

  it('text mentions connection refused', async () => {
    const result = await router.callOllama('Format this JSON');
    assert.ok(result.text.includes('connection refused'));
  });

  it('text includes the original prompt', async () => {
    const result = await router.callOllama('Format this JSON');
    assert.ok(result.text.includes('Format this JSON'));
  });

  it('increments ollamaFallbacks stat', async () => {
    const before = router.stats.ollamaFallbacks || 0;
    await router.callOllama('Format this JSON');
    assert.equal(router.stats.ollamaFallbacks, before + 1);
  });
});

describe('Ollama fallback — ETIMEDOUT', () => {
  let router;
  let savedFetch;

  beforeEach(() => {
    stubFs();
    router = new TaskRouter();
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      const err = new TypeError('fetch failed');
      err.cause = { code: 'ETIMEDOUT' };
      throw err;
    };
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    mock.restoreAll();
  });

  it('returns ollama-fallback source', async () => {
    const result = await router.callOllama('Sort this list');
    assert.equal(result.source, 'ollama-fallback');
  });

  it('sets label to OLLAMA-TIMEOUT', async () => {
    const result = await router.callOllama('Sort this list');
    assert.equal(result.label, 'OLLAMA-TIMEOUT');
  });

  it('text mentions timeout', async () => {
    const result = await router.callOllama('Sort this list');
    assert.ok(result.text.includes('timed out'));
  });
});

describe('Ollama fallback — HTTP non-200', () => {
  let router;
  let savedFetch;

  beforeEach(() => {
    stubFs();
    router = new TaskRouter();
    savedFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });
  });

  afterEach(() => {
    globalThis.fetch = savedFetch;
    mock.restoreAll();
  });

  it('returns ollama-fallback source', async () => {
    const result = await router.callOllama('Parse this YAML');
    assert.equal(result.source, 'ollama-fallback');
  });

  it('sets label to OLLAMA-ERROR', async () => {
    const result = await router.callOllama('Parse this YAML');
    assert.equal(result.label, 'OLLAMA-ERROR');
  });

  it('text includes the HTTP status code', async () => {
    const result = await router.callOllama('Parse this YAML');
    assert.ok(result.text.includes('404'));
  });

  it('text includes statusText', async () => {
    const result = await router.callOllama('Parse this YAML');
    assert.ok(result.text.includes('Not Found'));
  });
});
