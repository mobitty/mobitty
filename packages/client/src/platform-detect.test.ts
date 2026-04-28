import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { detectOS, defaultHotkeysForOS, resolveHotkey, eventToComboString, describeHotkey, HOTKEY_DEFAULT } from './platform-detect.ts';
import { parseComboString } from './softkey-types.ts';

const UA_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const UA_MACOS = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15';
const UA_LINUX = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';
const UA_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15';
const UA_ANDROID = 'Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36';

describe('detectOS', () => {
  it('detects windows', () => assert.equal(detectOS(UA_WINDOWS), 'windows'));
  it('detects macos', () => assert.equal(detectOS(UA_MACOS), 'macos'));
  it('detects linux', () => assert.equal(detectOS(UA_LINUX), 'linux'));
  it('detects ios (iPhone)', () => assert.equal(detectOS(UA_IOS), 'ios'));
  it('detects ios (iPad)', () => assert.equal(detectOS(UA_IPAD), 'ios'));
  it('detects android (over linux)', () => assert.equal(detectOS(UA_ANDROID), 'android'));
  it('returns unknown for unrecognized UA', () => assert.equal(detectOS('Foo/1.0'), 'unknown'));
});

describe('defaultHotkeysForOS', () => {
  it('windows binds Ctrl+Shift+z and Ctrl+Shift+x', () => {
    assert.deepEqual(defaultHotkeysForOS('windows'), { copy: 'Ctrl+Shift+z', paste: 'Ctrl+Shift+x' });
  });
  it('macos binds nothing (native handles)', () => {
    assert.deepEqual(defaultHotkeysForOS('macos'), { copy: null, paste: null });
  });
  it('linux binds nothing', () => {
    assert.deepEqual(defaultHotkeysForOS('linux'), { copy: null, paste: null });
  });
  it('ios binds nothing', () => {
    assert.deepEqual(defaultHotkeysForOS('ios'), { copy: null, paste: null });
  });
  it('unknown binds nothing', () => {
    assert.deepEqual(defaultHotkeysForOS('unknown'), { copy: null, paste: null });
  });
});

describe('resolveHotkey', () => {
  it('default sentinel resolves to platform default (windows copy)', () => {
    assert.equal(resolveHotkey(HOTKEY_DEFAULT, 'copy', 'windows'), 'Ctrl+Shift+z');
  });
  it('default sentinel resolves to platform default (windows paste)', () => {
    assert.equal(resolveHotkey(HOTKEY_DEFAULT, 'paste', 'windows'), 'Ctrl+Shift+x');
  });
  it('default sentinel resolves to null on macos', () => {
    assert.equal(resolveHotkey(HOTKEY_DEFAULT, 'copy', 'macos'), null);
    assert.equal(resolveHotkey(HOTKEY_DEFAULT, 'paste', 'macos'), null);
  });
  it('empty string resolves to null (explicit disable)', () => {
    assert.equal(resolveHotkey('', 'copy', 'windows'), null);
    assert.equal(resolveHotkey('', 'paste', 'windows'), null);
  });
  it('literal combo resolves to itself', () => {
    assert.equal(resolveHotkey('Ctrl+Shift+v', 'paste', 'macos'), 'Ctrl+Shift+v');
    assert.equal(resolveHotkey('Ctrl+Shift+c', 'copy', 'linux'), 'Ctrl+Shift+c');
  });
});

interface Mods { ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean }
function makeEvent(key: string, mods: Mods = {}) {
  return {
    key,
    ctrlKey: mods.ctrl ?? false,
    altKey: mods.alt ?? false,
    shiftKey: mods.shift ?? false,
    metaKey: mods.meta ?? false,
  };
}

describe('eventToComboString', () => {
  it('serializes Ctrl+Shift+v', () => {
    assert.equal(eventToComboString(makeEvent('v', { ctrl: true, shift: true })), 'Ctrl+Shift+v');
  });

  it('lowercases uppercase letter', () => {
    assert.equal(eventToComboString(makeEvent('V', { ctrl: true, shift: true })), 'Ctrl+Shift+v');
  });

  it('serializes single letter without modifiers', () => {
    assert.equal(eventToComboString(makeEvent('a')), 'a');
  });

  it('serializes virtual keys (Escape -> esc, ArrowLeft -> left)', () => {
    assert.equal(eventToComboString(makeEvent('Escape', { ctrl: true })), 'Ctrl+esc');
    assert.equal(eventToComboString(makeEvent('ArrowLeft', { alt: true })), 'Alt+left');
  });

  it('returns null for modifier-only events', () => {
    assert.equal(eventToComboString(makeEvent('Control', { ctrl: true })), null);
    assert.equal(eventToComboString(makeEvent('Shift', { shift: true })), null);
    assert.equal(eventToComboString(makeEvent('Alt', { alt: true })), null);
    assert.equal(eventToComboString(makeEvent('Meta', { meta: true })), null);
  });

  it('returns null when meta is held (disallow Cmd-bindings)', () => {
    assert.equal(eventToComboString(makeEvent('v', { meta: true })), null);
    assert.equal(eventToComboString(makeEvent('v', { ctrl: true, meta: true })), null);
  });

  it('returns null for unrecognized multi-char keys', () => {
    assert.equal(eventToComboString(makeEvent('CapsLock', { ctrl: true })), null);
    assert.equal(eventToComboString(makeEvent('F5')), null);
  });

  it('output round-trips through parseComboString', () => {
    const cases: Array<[string, Mods]> = [
      ['v', { ctrl: true, shift: true }],
      ['c', { ctrl: true }],
      ['Tab', { alt: true }],
      ['ArrowUp', { ctrl: true, shift: true }],
    ];
    for (const [key, mods] of cases) {
      const serialized = eventToComboString(makeEvent(key, mods));
      assert.notEqual(serialized, null, `failed to serialize ${key}`);
      const parsed = parseComboString(serialized!);
      assert.notEqual(parsed, null, `parseComboString rejected ${serialized}`);
      assert.equal(parsed!.modifiers.ctrl, mods.ctrl ?? false);
      assert.equal(parsed!.modifiers.alt, mods.alt ?? false);
      assert.equal(parsed!.modifiers.shift, mods.shift ?? false);
    }
  });
});

describe('describeHotkey', () => {
  it('renders empty string as "None"', () => {
    assert.equal(describeHotkey('', 'copy'), 'None');
  });

  it('renders literal combo verbatim', () => {
    assert.equal(describeHotkey('Ctrl+Shift+v', 'paste'), 'Ctrl+Shift+v');
  });

  it('renders default sentinel as "Default (...)" with platform default', () => {
    const label = describeHotkey(HOTKEY_DEFAULT, 'copy');
    // Will be 'Default (Ctrl+Shift+z)' on Windows or 'Default (none)' otherwise.
    assert.ok(label.startsWith('Default ('));
    assert.ok(label.endsWith(')'));
  });
});
