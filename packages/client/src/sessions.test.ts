import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SESSION_URL_PARAM, sessionIdFromSearch, withSessionParam } from './sessions.ts';

describe('sessionIdFromSearch', () => {
  it('reads the session parameter', () => {
    assert.equal(sessionIdFromSearch(`?${SESSION_URL_PARAM}=abc-123`), 'abc-123');
  });
  it('finds it among other parameters', () => {
    assert.equal(sessionIdFromSearch('?token=x&session=abc&y=1'), 'abc');
  });
  it('decodes escaped ids', () => {
    assert.equal(sessionIdFromSearch('?session=a%2Fb%20c'), 'a/b c');
  });
  it('returns null when absent', () => {
    assert.equal(sessionIdFromSearch(''), null);
    assert.equal(sessionIdFromSearch('?token=x'), null);
  });
  it('returns null when empty', () => {
    assert.equal(sessionIdFromSearch('?session='), null);
  });
});

describe('withSessionParam', () => {
  it('adds the parameter, keeping path, other parameters and hash', () => {
    assert.equal(
      withSessionParam('https://host:8080/sub/path/?token=x#frag', 'abc'),
      'https://host:8080/sub/path/?token=x&session=abc#frag',
    );
  });
  it('replaces an existing session parameter', () => {
    assert.equal(
      withSessionParam('https://host/?session=old&token=x', 'new'),
      'https://host/?session=new&token=x',
    );
  });
  it('escapes ids so they round-trip', () => {
    const href = withSessionParam('https://host/', 'a/b c&d');
    assert.equal(sessionIdFromSearch(new URL(href).search), 'a/b c&d');
  });
  it('removes the parameter when null', () => {
    assert.equal(
      withSessionParam('https://host/?token=x&session=abc', null),
      'https://host/?token=x',
    );
    assert.equal(withSessionParam('https://host/?session=abc', null), 'https://host/');
  });
});
