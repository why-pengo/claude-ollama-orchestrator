// Tests for assessComplexityWithReason() — verifies routing decisions include
// the correct keyword match or fallback reason for --dry-run output.
// Run with: node --test tests/dryrun.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import TaskRouter from '../ollama-router.js';

const router = new TaskRouter();
const assess = (p) => router.assessComplexityWithReason(p);

describe('assessComplexityWithReason — complex keyword match', () => {
  it('returns complexity complex', () =>
    assert.equal(assess('Design a REST API').complexity, 'complex'));

  it('names the matched keyword', () =>
    assert.ok(assess('Design a REST API').reason.includes('"design"')));

  it('attributes to complex list', () =>
    assert.ok(assess('Design a REST API').reason.includes('complex list')));

  it('picks first matching complex keyword', () => {
    const { reason } = assess('debug and refactor this module');
    assert.ok(reason.includes('"debug"'));
  });
});

describe('assessComplexityWithReason — simple keyword match', () => {
  it('returns complexity simple', () =>
    assert.equal(assess('Extract all URLs').complexity, 'simple'));

  it('names the matched keyword', () =>
    assert.ok(assess('Extract all URLs').reason.includes('"extract"')));

  it('attributes to simple list', () =>
    assert.ok(assess('Extract all URLs').reason.includes('simple list')));
});

describe('assessComplexityWithReason — length fallback', () => {
  it('long prompt with no keywords returns complex', () =>
    assert.equal(assess('x'.repeat(501)).complexity, 'complex'));

  it('long prompt reason mentions length', () =>
    assert.ok(assess('x'.repeat(501)).reason.includes('length fallback')));

  it('short prompt with no keywords returns simple', () =>
    assert.equal(assess('What is 2 + 2?').complexity, 'simple'));

  it('short prompt reason mentions length fallback', () =>
    assert.ok(assess('What is 2 + 2?').reason.includes('length fallback')));
});

describe('assessComplexityWithReason — complex beats simple', () => {
  it('"clean up and organise" routes complex (clean wins)', () => {
    const { complexity, reason } = assess('clean up and organise this file');
    assert.equal(complexity, 'complex');
    assert.ok(reason.includes('"clean"'));
  });
});
