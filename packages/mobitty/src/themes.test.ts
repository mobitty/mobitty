import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BUILTIN_THEMES,
  BUILTIN_THEME_NAMES,
  BUILTIN_THEME_LIST,
  DEFAULT_THEME_NAME,
  ThemeStore,
} from './themes.ts';

function validTheme(name = 'test') {
  const entry = BUILTIN_THEMES.get('default-dark');
  return { name, colors: { ...entry!.colors } };
}

describe('ThemeStore', () => {
  let tmpDir: string;
  let store: ThemeStore;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-themes-test-'));
    store = new ThemeStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('ensureDefaults creates themes dir', () => {
    store.ensureDefaults();
    assert.ok(existsSync(join(tmpDir, 'themes')));
  });

  it('ensureDefaults does not create default.json on disk', () => {
    store.ensureDefaults();
    assert.ok(!existsSync(join(tmpDir, 'themes', 'default.json')));
  });

  it('ensureDefaults removes old default.json (migration)', () => {
    mkdirSync(join(tmpDir, 'themes'), { recursive: true });
    writeFileSync(join(tmpDir, 'themes', 'default.json'), '{}');
    assert.ok(existsSync(join(tmpDir, 'themes', 'default.json')));
    store.ensureDefaults();
    assert.ok(!existsSync(join(tmpDir, 'themes', 'default.json')));
  });

  it('list returns built-in theme names', () => {
    store.ensureDefaults();
    const names = store.list();
    assert.ok(names.includes('default'));
    assert.ok(names.includes('default-dark'));
    assert.ok(names.includes('default-light'));
    assert.ok(names.includes('dracula'));
    assert.ok(names.includes('nord'));
  });

  it('list returns built-in names even without themes dir', () => {
    const names = store.list();
    assert.ok(names.includes('default'));
    assert.ok(names.length >= BUILTIN_THEME_LIST.length);
  });

  it('list includes user themes after built-ins', () => {
    store.ensureDefaults();
    store.save('my-custom', validTheme('my-custom'));
    const names = store.list();
    const builtinCount = BUILTIN_THEME_LIST.length;
    assert.ok(names.includes('my-custom'));
    assert.ok(names.indexOf('my-custom') >= builtinCount);
  });

  it('list excludes disk files that shadow built-in names', () => {
    store.ensureDefaults();
    // Manually write a file with a built-in name
    writeFileSync(join(tmpDir, 'themes', 'dracula.json'), '{}');
    const names = store.list();
    // 'dracula' should appear exactly once (from built-ins)
    assert.equal(names.filter(n => n === 'dracula').length, 1);
  });

  it('get("default") returns default-dark colors with name "default"', () => {
    store.ensureDefaults();
    const theme = store.get('default') as Record<string, unknown>;
    assert.ok(theme !== undefined);
    assert.equal(theme['name'], 'default');
    const darkEntry = BUILTIN_THEMES.get('default-dark');
    assert.deepEqual(theme['colors'], darkEntry!.colors);
  });

  it('get returns built-in theme data', () => {
    store.ensureDefaults();
    const theme = store.get('dracula') as Record<string, unknown>;
    assert.ok(theme !== undefined);
    assert.equal(theme['name'], 'dracula');
    const entry = BUILTIN_THEMES.get('dracula');
    assert.deepEqual(theme['colors'], entry!.colors);
  });

  it('get returns undefined for missing theme', () => {
    store.ensureDefaults();
    assert.equal(store.get('nonexistent'), undefined);
  });

  it('get returns undefined for invalid name', () => {
    assert.equal(store.get('../evil'), undefined);
  });

  it('get returns user theme from disk', () => {
    store.ensureDefaults();
    const t = validTheme('custom');
    store.save('custom', t);
    const loaded = store.get('custom') as Record<string, unknown>;
    assert.ok(loaded !== undefined);
    assert.equal(loaded['name'], 'custom');
  });

  it('save writes a user theme', () => {
    store.ensureDefaults();
    const t = validTheme('custom');
    store.save('custom', t);
    const loaded = store.get('custom') as Record<string, unknown>;
    assert.ok(loaded !== undefined);
    assert.equal(loaded['name'], 'custom');
  });

  it('save throws when saving default theme', () => {
    store.ensureDefaults();
    assert.throws(() => store.save(DEFAULT_THEME_NAME, validTheme(DEFAULT_THEME_NAME)));
  });

  it('save throws when saving any built-in theme', () => {
    store.ensureDefaults();
    assert.throws(() => store.save('dracula', validTheme('dracula')));
    assert.throws(() => store.save('default-dark', validTheme('default-dark')));
    assert.throws(() => store.save('nord', validTheme('nord')));
  });

  it('save throws on invalid name', () => {
    store.ensureDefaults();
    assert.throws(() => store.save('../evil', { name: '../evil' }));
  });

  it('delete removes a user theme', () => {
    store.ensureDefaults();
    store.save('deleteme', validTheme('deleteme'));
    assert.ok(store.get('deleteme') !== undefined);
    assert.ok(store.delete('deleteme'));
    assert.equal(store.get('deleteme'), undefined);
  });

  it('delete refuses to delete default', () => {
    store.ensureDefaults();
    assert.ok(!store.delete(DEFAULT_THEME_NAME));
  });

  it('delete refuses to delete any built-in theme', () => {
    store.ensureDefaults();
    assert.ok(!store.delete('dracula'));
    assert.ok(!store.delete('default-dark'));
    assert.ok(!store.delete('nord'));
  });

  it('delete returns false for nonexistent theme', () => {
    store.ensureDefaults();
    assert.ok(!store.delete('nonexistent'));
  });
});

describe('Built-in theme data', () => {
  it('BUILTIN_THEME_NAMES includes default and all entries', () => {
    assert.ok(BUILTIN_THEME_NAMES.has('default'));
    assert.ok(BUILTIN_THEME_NAMES.has('default-dark'));
    assert.ok(BUILTIN_THEME_NAMES.has('default-light'));
    assert.ok(BUILTIN_THEME_NAMES.has('dracula'));
    assert.ok(BUILTIN_THEME_NAMES.has('nord'));
    assert.ok(BUILTIN_THEME_NAMES.has('solarized-dark'));
    assert.ok(BUILTIN_THEME_NAMES.has('solarized-light'));
  });

  it('BUILTIN_THEME_LIST starts with default', () => {
    assert.equal(BUILTIN_THEME_LIST[0], 'default');
  });

  it('all built-in themes have valid hex colors', () => {
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    for (const [name, entry] of BUILTIN_THEMES) {
      const colors = entry.colors;
      for (const [key, value] of Object.entries(colors)) {
        assert.ok(hexRe.test(value), `${name}.${key} = "${value}" is not valid hex`);
      }
    }
  });

  it('all built-in themes have exactly 18 color keys', () => {
    const expectedKeys = [
      'foreground', 'background', 'cursor',
      'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
      'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
      'brightMagenta', 'brightCyan', 'brightWhite',
    ];
    for (const [name, entry] of BUILTIN_THEMES) {
      const keys = Object.keys(entry.colors).sort();
      assert.deepEqual(keys, [...expectedKeys].sort(), `${name} has wrong color keys`);
    }
  });
});
