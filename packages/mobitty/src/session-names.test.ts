import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionName, generateUniqueSessionName } from './session-names.ts';

describe('generateSessionName', () => {
  it('returns snake_case format', () => {
    for (let i = 0; i < 50; i++) {
      const name = generateSessionName();
      assert.match(name, /^[a-z]+_[a-z]+$/);
    }
  });

  it('produces varying names', () => {
    const names = new Set<string>();
    for (let i = 0; i < 20; i++) {
      names.add(generateSessionName());
    }
    assert.ok(names.size > 1, 'expected more than one unique name');
  });
});

describe('generateUniqueSessionName', () => {
  it('returns a name not in the existing set', () => {
    const existing = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const name = generateUniqueSessionName(existing);
      assert.ok(!existing.has(name));
      existing.add(name);
    }
  });

  it('handles large existing sets by appending digits', () => {
    // Fill existing with many names so collisions are likely
    const existing = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      existing.add(generateSessionName());
    }
    const name = generateUniqueSessionName(existing);
    assert.ok(!existing.has(name));
    assert.ok(typeof name === 'string' && name.length > 0);
  });
});
