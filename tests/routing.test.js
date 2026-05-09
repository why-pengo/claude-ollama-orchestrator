// Tests for assessComplexity() — three-tier routing matrix.
// Run with: node --test tests/routing.test.js

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import TaskRouter from '../ollama-router.js';

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
});

describe('assessComplexity — medium tasks', () => {
  it('debug Python traceback', () =>
    assert.equal(assess('Debug this Python traceback: AttributeError...'), 'medium'));
  it('explain TCP vs UDP', () =>
    assert.equal(assess('Explain the difference between TCP and UDP'), 'medium'));
  it('refactor', () =>
    assert.equal(assess('Refactor this function to be more readable'), 'medium'));
  it('design REST API', () =>
    assert.equal(assess('Design a REST API for a blog platform'), 'medium'));
  it('implement beats list', () =>
    assert.equal(assess('List steps to implement a login flow'), 'medium'));
  it('optimise (British)', () => assert.equal(assess('Optimise this database query'), 'medium'));
  it('optimize (American)', () => assert.equal(assess('Optimize this database query'), 'medium'));
  it('reason about tradeoffs', () =>
    assert.equal(assess('Reason through the options for this design'), 'medium'));
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
