import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseOsc9, parseOsc99, parseOsc777 } from './osc-notifications.ts';

describe('parseOsc9', () => {
  it('parses plain iTerm2 format', () => {
    const result = parseOsc9('Task complete');
    assert.deepEqual(result, { title: 'Notification', body: 'Task complete' });
  });

  it('parses ConEmu sub-command 2 format', () => {
    const result = parseOsc9('2;Task complete');
    assert.deepEqual(result, { title: 'Notification', body: 'Task complete' });
  });

  it('parses ConEmu sub-command with semicolons in body', () => {
    const result = parseOsc9('2;line1;line2;line3');
    assert.deepEqual(result, { title: 'Notification', body: 'line1;line2;line3' });
  });
});

describe('parseOsc99', () => {
  it('parses basic notification with body', () => {
    const result = parseOsc99('d=0;Build finished');
    assert.deepEqual(result, { title: 'Notification', body: 'Build finished' });
  });

  it('parses notification with p=title flag', () => {
    const result = parseOsc99('d=0:p=title;Build Status');
    assert.deepEqual(result, { title: 'Build Status', body: '' });
  });

  it('returns null for missing semicolon', () => {
    const result = parseOsc99('d=0');
    assert.equal(result, null);
  });

  it('parses with multiple params', () => {
    const result = parseOsc99('d=0:i=myid;Hello world');
    assert.deepEqual(result, { title: 'Notification', body: 'Hello world' });
  });
});

describe('parseOsc777', () => {
  it('parses notify format with title and body', () => {
    const result = parseOsc777('notify;Deploy;Deployed to production');
    assert.deepEqual(result, { title: 'Deploy', body: 'Deployed to production' });
  });

  it('parses notify with title only', () => {
    const result = parseOsc777('notify;Done');
    assert.deepEqual(result, { title: 'Done', body: '' });
  });

  it('returns null for non-notify command', () => {
    const result = parseOsc777('other;something');
    assert.equal(result, null);
  });

  it('parses body with semicolons', () => {
    const result = parseOsc777('notify;Title;body;with;semicolons');
    assert.deepEqual(result, { title: 'Title', body: 'body;with;semicolons' });
  });
});
