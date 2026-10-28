import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BROWSER_CAPABILITIES, isTypedInput, markTitle } from './session-alert.ts';

describe('markTitle', () => {
  it('marks the title while the session has an alert', () => {
    assert.equal(markTitle('build', true), '• build');
  });
  it('leaves the title alone without one', () => {
    assert.equal(markTitle('build', false), 'build');
  });
});

describe('isTypedInput', () => {
  it('counts keys and pastes', () => {
    assert.equal(isTypedInput('a'), true);
    assert.equal(isTypedInput('\r'), true);
    assert.equal(isTypedInput('\x1b[A'), true);
    assert.equal(isTypedInput('hello world'), true);
  });
  it('does not count focus reports', () => {
    assert.equal(isTypedInput('\x1b[I'), false);
    assert.equal(isTypedInput('\x1b[O'), false);
  });
  it('does not count mouse reports', () => {
    assert.equal(isTypedInput('\x1b[<35;10;5M'), false);
    assert.equal(isTypedInput('\x1b[<0;1;1m'), false);
    assert.equal(isTypedInput('\x1b[M !!'), false);
  });
});

describe('BROWSER_CAPABILITIES', () => {
  it('asks only for the session\'s own alerts, leaving every other feature at its default', () => {
    assert.deepEqual(BROWSER_CAPABILITIES, { sessionAlerts: true });
  });
});
