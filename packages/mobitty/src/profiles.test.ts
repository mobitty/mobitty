import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ProfileStore, DEFAULT_PROFILE_NAMES } from './profiles.ts';

function sampleProfile(name = 'test') {
  return { name, fontSize: 14, fontFamily: 'monospace', themeLight: 'default-light', themeDark: 'default-dark', scrollback: 5000, padding: 4 };
}

describe('ProfileStore', () => {
  let tmpDir: string;
  let store: ProfileStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-profiles-test-'));
    store = new ProfileStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDefaults creates profiles dir', () => {
    store.ensureDefaults();
    assert.ok(existsSync(join(tmpDir, 'profiles')));
  });

  it('list always includes both defaults first', () => {
    store.ensureDefaults();
    const names = store.list();
    assert.equal(names[0], 'default-desktop');
    assert.equal(names[1], 'default-mobile');
  });

  it('list includes defaults even without profiles dir', () => {
    const freshStore = new ProfileStore(join(tmpDir, 'nonexistent'));
    const names = freshStore.list();
    assert.deepEqual(names, [...DEFAULT_PROFILE_NAMES]);
  });

  it('get returns undefined for default-desktop', () => {
    assert.equal(store.get('default-desktop'), undefined);
  });

  it('get returns undefined for default-mobile', () => {
    assert.equal(store.get('default-mobile'), undefined);
  });

  it('get returns undefined for missing profile', () => {
    store.ensureDefaults();
    assert.equal(store.get('nonexistent'), undefined);
  });

  it('get returns undefined for invalid name', () => {
    assert.equal(store.get('../evil'), undefined);
  });

  it('save writes and get reads a profile', () => {
    store.ensureDefaults();
    const p = sampleProfile('custom');
    store.save('custom', p);
    const loaded = store.get('custom') as Record<string, unknown>;
    assert.ok(loaded !== undefined);
    assert.equal(loaded['name'], 'custom');
    assert.equal(loaded['fontSize'], 14);
  });

  it('save writes valid JSON to disk', () => {
    store.ensureDefaults();
    store.save('disk', sampleProfile('disk'));
    const raw = readFileSync(join(tmpDir, 'profiles', 'disk.json'), 'utf-8');
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    assert.equal(parsed['name'], 'disk');
  });

  it('save throws on invalid name', () => {
    store.ensureDefaults();
    assert.throws(() => store.save('../evil', { name: '../evil' }));
  });

  it('save throws when saving default-desktop profile', () => {
    store.ensureDefaults();
    assert.throws(() => store.save('default-desktop', sampleProfile('default-desktop')));
  });

  it('save throws when saving default-mobile profile', () => {
    store.ensureDefaults();
    assert.throws(() => store.save('default-mobile', sampleProfile('default-mobile')));
  });

  it('delete removes a profile', () => {
    store.ensureDefaults();
    store.save('deleteme', sampleProfile('deleteme'));
    assert.ok(store.get('deleteme') !== undefined);
    assert.ok(store.delete('deleteme'));
    assert.equal(store.get('deleteme'), undefined);
  });

  it('delete refuses to delete default-desktop', () => {
    assert.ok(!store.delete('default-desktop'));
  });

  it('delete refuses to delete default-mobile', () => {
    assert.ok(!store.delete('default-mobile'));
  });

  it('delete returns false for nonexistent profile', () => {
    store.ensureDefaults();
    assert.ok(!store.delete('nonexistent'));
  });
});
