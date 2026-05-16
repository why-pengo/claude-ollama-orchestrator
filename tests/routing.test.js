// Tests for assessComplexity() — three-tier routing matrix.
// Run with: node --test tests/routing.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import TaskRouter, { SIMPLE_SIZE_LIMIT } from '../ollama-router.js';

const router = new TaskRouter();
const assess = (p) => router.assessComplexity(p);

describe('assessComplexity — simple tasks', () => {
  it('format JSON', () => assert.equal(assess("Format this JSON: {name:'alice'}"), 'simple'));
  it('extract URLs', () => assert.equal(assess('Extract all URLs from this text'), 'simple'));
  it('convert CSV to JSON', () => assert.equal(assess('Convert this CSV to JSON'), 'simple'));
  it('sort a list', () => assert.equal(assess('Sort this list: banana, apple, cherry'), 'simple'));
  it('parse YAML', () => assert.equal(assess('Parse this YAML block'), 'simple'));
  it('list items (no medium/complex keyword)', () =>
    assert.equal(assess('List all files in this directory output'), 'simple'));
  it('rename fields', () =>
    assert.equal(assess('Rename all snake_case fields to camelCase'), 'simple'));
  it('template substitution', () =>
    assert.equal(assess('Fill in this template with the provided values'), 'simple'));
  it('organise (British spelling)', () =>
    assert.equal(assess('Organise these items alphabetically'), 'simple'));
  it('organize (American spelling)', () =>
    assert.equal(assess('Organize these items alphabetically'), 'simple'));
  it('case-insensitive match', () =>
    assert.equal(assess('EXTRACT all class names from this file'), 'simple'));
  it('summarise (British)', () => assert.equal(assess('Summarise this PR description'), 'simple'));
  it('summarize (American)', () => assert.equal(assess('Summarize this PR description'), 'simple'));
  it('count items', () => assert.equal(assess('Count the failing assertions'), 'simple'));
  it('enumerate fields', () => assert.equal(assess('Enumerate the public fields'), 'simple'));
  it('outline structure', () =>
    assert.equal(assess('Outline the sections in this document'), 'simple'));
  it('tldr', () => assert.equal(assess('Give me a tldr of this issue'), 'simple'));
  it('draft message', () =>
    assert.equal(assess('Draft a short error message for this case'), 'simple'));
  it('stub test', () => assert.equal(assess('Stub a pytest case for this function'), 'simple'));
});

describe('assessComplexity — medium tasks', () => {
  it('explain TCP vs UDP', () =>
    assert.equal(assess('Explain the difference between TCP and UDP'), 'medium'));
  it('reason through options', () =>
    assert.equal(assess('Reason through these options'), 'medium'));
});

describe('assessComplexity — complex tasks', () => {
  it('architect microservices', () =>
    assert.equal(assess('Architect a microservices system for this use case'), 'complex'));
  it('security review', () =>
    assert.equal(assess('Security review this authentication handler'), 'complex'));
  it('tradeoff analysis', () =>
    assert.equal(assess('What are the tradeoffs between SQL and NoSQL here?'), 'complex'));
  it('plan', () => assert.equal(assess('Plan the migration strategy for this service'), 'complex'));
  it('clean beats organise', () =>
    assert.equal(assess('Clean up and organise this code'), 'complex'));
  it('debug Python traceback', () =>
    assert.equal(assess('Debug this Python traceback: AttributeError...'), 'complex'));
  it('refactor', () =>
    assert.equal(assess('Refactor this function to be more readable'), 'complex'));
  it('design REST API', () =>
    assert.equal(assess('Design a REST API for a blog platform'), 'complex'));
  it('implement beats list', () =>
    assert.equal(assess('List steps to implement a login flow'), 'complex'));
  it('optimise (British)', () => assert.equal(assess('Optimise this database query'), 'complex'));
  it('optimize (American)', () => assert.equal(assess('Optimize this database query'), 'complex'));
  it('reason with design keyword routes complex (design wins)', () =>
    assert.equal(assess('Reason through the options for this design'), 'complex'));
});

describe('assessComplexity — fallback (no keywords)', () => {
  it('short prompt with no keywords defaults to simple', () =>
    assert.equal(assess('What is 2 + 2?'), 'simple'));
  it('prompt over 500 chars with no keywords defaults to complex', () =>
    assert.equal(assess('x'.repeat(501)), 'complex'));
  it('prompt exactly 500 chars defaults to simple', () =>
    assert.equal(assess('x'.repeat(500)), 'simple'));
});

describe('assessComplexity — known substring edge cases', () => {
  // "plan" is a substring of "planets" — documents known behaviour
  it('"planets" matches "plan" and routes complex', () =>
    assert.equal(assess('List the planets in the solar system'), 'complex'));
});

describe('assessComplexity — simple-keyword size escalation', () => {
  const LIMIT = SIMPLE_SIZE_LIMIT;
  const prefix = 'Extract values ';
  const atLimit = `${prefix}${'x'.repeat(Math.max(0, LIMIT - prefix.length))}`;
  const overLimit = atLimit + 'x';

  it('simple keyword at size limit stays simple', () => assert.equal(assess(atLimit), 'simple'));
  it('simple keyword one char over limit escalates to medium', () =>
    assert.equal(assess(overLimit), 'medium'));
  it('all simple keywords escalate when oversized', () => {
    const big = 'x'.repeat(LIMIT + 1);
    for (const kw of [
      'format',
      'extract',
      'convert',
      'parse',
      'organise',
      'organize',
      'list',
      'template',
      'rename',
      'sort',
      'summarise',
      'summarize',
      'count',
      'enumerate',
      'outline',
      'tldr',
      'draft',
      'stub',
    ]) {
      assert.equal(assess(`${kw} ${big}`), 'medium', `expected medium for keyword "${kw}"`);
    }
  });
  it('complex keyword still wins over size escalation', () =>
    assert.equal(assess(`refactor ${'x'.repeat(LIMIT + 1)}`), 'complex'));
  it('medium keyword still wins over size escalation', () =>
    assert.equal(assess(`explain ${'x'.repeat(LIMIT + 1)}`), 'medium'));
  it('reason string includes escalation message', () => {
    const { reason } = router.assessComplexityWithReason(overLimit);
    assert.ok(reason.includes('escalated to tier 2'), `unexpected reason: ${reason}`);
  });
});
