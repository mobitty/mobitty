import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateProfileFields, validateField, PROFILE_FIELD_RULES,
  isProfile, isProfileTheme, validateHotkeyString,
} from './profile-schema.ts';

function validCandidate(): Record<string, unknown> {
  return { name: 'test', fontSize: 14, fontFamily: 'monospace', themeLight: 'default-light', themeDark: 'default-dark', scrollback: 5000, padding: 4, optionIsMeta: true, notificationMode: 'ghostty', remoteEditor: false, copyOnSelect: false };
}

describe('validateProfileFields', () => {
  it('returns empty map for valid candidate', () => {
    assert.equal(validateProfileFields(validCandidate()).size, 0);
  });

  // name
  it('errors on empty name', () => {
    const c = validCandidate();
    c['name'] = '';
    assert.equal(validateProfileFields(c).get('name'), 'Name is required');
  });

  it('errors on non-string name', () => {
    const c = validCandidate();
    c['name'] = 123;
    assert.equal(validateProfileFields(c).get('name'), 'Name is required');
  });

  it('errors on name with invalid chars', () => {
    const c = validCandidate();
    c['name'] = 'hello world!';
    assert.equal(validateProfileFields(c).get('name'), 'Only letters, numbers, hyphens, and underscores');
  });

  it('errors on name too long', () => {
    const c = validCandidate();
    c['name'] = 'a'.repeat(65);
    assert.equal(validateProfileFields(c).get('name'), 'Must be 64 characters or fewer');
  });

  // fontSize
  it('errors on NaN fontSize', () => {
    const c = validCandidate();
    c['fontSize'] = NaN;
    assert.equal(validateProfileFields(c).get('fontSize'), 'Must be a number');
  });

  it('errors on fontSize too small', () => {
    const c = validCandidate();
    c['fontSize'] = 5;
    assert.equal(validateProfileFields(c).get('fontSize'), 'Must be between 8 and 72');
  });

  it('errors on fontSize too large', () => {
    const c = validCandidate();
    c['fontSize'] = 100;
    assert.equal(validateProfileFields(c).get('fontSize'), 'Must be between 8 and 72');
  });

  // fontFamily
  it('errors on empty fontFamily', () => {
    const c = validCandidate();
    c['fontFamily'] = '';
    assert.equal(validateProfileFields(c).get('fontFamily'), 'Font family is required');
  });

  it('errors on fontFamily too long', () => {
    const c = validCandidate();
    c['fontFamily'] = 'x'.repeat(257);
    assert.equal(validateProfileFields(c).get('fontFamily'), 'Must be 256 characters or fewer');
  });

  // theme
  it('errors on empty themeLight', () => {
    const c = validCandidate();
    c['themeLight'] = '';
    assert.equal(validateProfileFields(c).get('themeLight'), 'Theme is required');
  });

  it('errors on themeDark with invalid chars', () => {
    const c = validCandidate();
    c['themeDark'] = 'my theme!';
    assert.equal(validateProfileFields(c).get('themeDark'), 'Only letters, numbers, hyphens, and underscores');
  });

  // scrollback
  it('errors on NaN scrollback', () => {
    const c = validCandidate();
    c['scrollback'] = NaN;
    assert.equal(validateProfileFields(c).get('scrollback'), 'Must be a number');
  });

  it('errors on non-integer scrollback', () => {
    const c = validCandidate();
    c['scrollback'] = 1000.5;
    assert.equal(validateProfileFields(c).get('scrollback'), 'Must be a whole number');
  });

  it('errors on scrollback too small', () => {
    const c = validCandidate();
    c['scrollback'] = 50;
    assert.equal(validateProfileFields(c).get('scrollback'), 'Must be between 100 and 50,000');
  });

  it('errors on scrollback too large', () => {
    const c = validCandidate();
    c['scrollback'] = 100000;
    assert.equal(validateProfileFields(c).get('scrollback'), 'Must be between 100 and 50,000');
  });

  // padding
  it('errors on padding too small', () => {
    const c = validCandidate();
    c['padding'] = -1;
    assert.equal(validateProfileFields(c).get('padding'), 'Must be between 0 and 48');
  });

  // optional fields — absent is valid
  it('skips optional softkeySize when absent', () => {
    const c = validCandidate();
    assert.equal(validateProfileFields(c).has('softkeySize'), false);
  });

  // optional fields — present but invalid
  it('errors on invalid softkeySize', () => {
    const c = validCandidate();
    c['softkeySize'] = 10;
    assert.equal(validateProfileFields(c).get('softkeySize'), 'Must be between 28 and 60');
  });

  // multiple errors
  it('returns multiple errors simultaneously', () => {
    const c = validCandidate();
    c['name'] = '';
    c['fontSize'] = NaN;
    c['padding'] = -1;
    c['scrollback'] = -1;
    const errors = validateProfileFields(c);
    assert.equal(errors.size, 4);
    assert.ok(errors.has('name'));
    assert.ok(errors.has('fontSize'));
    assert.ok(errors.has('padding'));
    assert.ok(errors.has('scrollback'));
  });
});

describe('validateField', () => {
  it('returns undefined for valid string field', () => {
    assert.equal(validateField(PROFILE_FIELD_RULES['name']!, 'test'), undefined);
  });

  it('returns undefined for valid number field', () => {
    assert.equal(validateField(PROFILE_FIELD_RULES['fontSize']!, 14), undefined);
  });

  it('returns undefined for valid optional number field when in range', () => {
    assert.equal(validateField(PROFILE_FIELD_RULES['softkeySize']!, 44), undefined);
  });

  it('returns error for optional number field out of range', () => {
    assert.equal(validateField(PROFILE_FIELD_RULES['softkeySize']!, 10), 'Must be between 28 and 60');
  });
});

describe('isProfile', () => {
  it('accepts a valid profile', () => {
    assert.ok(isProfile(validCandidate()));
  });

  it('accepts a full profile with softkeys and gestures', () => {
    assert.ok(isProfile({
      ...validCandidate(),
      softkeySize: 44,
      softkeys: { pages: [['esc']], customKeys: [], containers: [] },
      gestures: { 'double-tap': 'esc' },
    }));
  });

  it('rejects null', () => {
    assert.ok(!isProfile(null));
  });

  it('rejects fontSize as a nested object (old format)', () => {
    assert.ok(!isProfile({ ...validCandidate(), fontSize: { mobile: 14, desktop: 14 } }));
  });

  it('rejects fontSize below 8', () => {
    assert.ok(!isProfile({ ...validCandidate(), fontSize: 7 }));
  });

  it('rejects fontSize above 72', () => {
    assert.ok(!isProfile({ ...validCandidate(), fontSize: 73 }));
  });

  it('rejects non-finite fontSize', () => {
    assert.ok(!isProfile({ ...validCandidate(), fontSize: Infinity }));
  });

  it('rejects theme as a nested object (old format)', () => {
    assert.ok(!isProfile({ ...validCandidate(), themeLight: undefined, theme: { desktopLight: 'default-light', desktopDark: 'default-dark' } }));
  });

  it('accepts profile with sessionSwitcherHotkey', () => {
    assert.ok(isProfile({ ...validCandidate(), sessionSwitcherHotkey: 'Ctrl+Shift+s' }));
  });

  it('accepts profile without sessionSwitcherHotkey', () => {
    assert.ok(isProfile(validCandidate()));
  });

  it('accepts empty sessionSwitcherHotkey (disabled)', () => {
    assert.ok(isProfile({ ...validCandidate(), sessionSwitcherHotkey: '' }));
  });

  it('rejects sessionSwitcherHotkey with no main key', () => {
    assert.ok(!isProfile({ ...validCandidate(), sessionSwitcherHotkey: 'Ctrl+Shift' }));
  });

  it('rejects multi-step sessionSwitcherHotkey', () => {
    assert.ok(!isProfile({ ...validCandidate(), sessionSwitcherHotkey: 'Ctrl+b, s' }));
  });

  it('accepts sessionSwitcherHotkey with virtual key', () => {
    assert.ok(isProfile({ ...validCandidate(), sessionSwitcherHotkey: 'Ctrl+tab' }));
  });
});

describe('validateHotkeyString', () => {
  it('accepts empty string', () => {
    assert.equal(validateHotkeyString(''), null);
  });

  it('accepts Ctrl+Shift+s', () => {
    assert.equal(validateHotkeyString('Ctrl+Shift+s'), null);
  });

  it('rejects modifier-only', () => {
    assert.ok(validateHotkeyString('Ctrl+Shift') !== null);
  });

  it('rejects multi-step combo', () => {
    assert.ok(validateHotkeyString('Ctrl+b, s') !== null);
  });

  it('rejects unknown modifier', () => {
    assert.ok(validateHotkeyString('Meta+s') !== null);
  });

  it('rejects two main keys', () => {
    assert.ok(validateHotkeyString('Ctrl+a+b') !== null);
  });
});

describe('isProfileTheme', () => {
  const validTheme = () => ({
    foreground: '#d2d2d2', background: '#2b2b2b', cursor: '#adadad',
    black: '#000000', red: '#d81e00', green: '#5ea702', yellow: '#cfae00',
    blue: '#427ab3', magenta: '#89658e', cyan: '#00a7aa', white: '#dbded8',
    brightBlack: '#686a66', brightRed: '#f54235', brightGreen: '#99e343',
    brightYellow: '#fdeb61', brightBlue: '#84b0d8', brightMagenta: '#bc94b7',
    brightCyan: '#37e6e8', brightWhite: '#f1f1f0',
  });

  it('accepts a valid theme', () => {
    assert.ok(isProfileTheme(validTheme()));
  });

  it('rejects null', () => {
    assert.ok(!isProfileTheme(null));
  });

  it('rejects missing color key', () => {
    const theme = validTheme() as Record<string, unknown>;
    delete theme['cursor'];
    assert.ok(!isProfileTheme(theme));
  });

  it('rejects invalid hex color', () => {
    assert.ok(!isProfileTheme({ ...validTheme(), red: 'not-a-color' }));
  });
});
