// ── Types ────────────────────────────────────────────────────────────────────

export interface ProfileTheme {
  foreground: string;
  background: string;
  cursor: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface SoftkeyCustomKeySpec {
  id: string;
  label: string;
  combo: string[];
}

export interface SoftkeyContainerSpec {
  id: string;
  label: string;
  keys: string[];
}

export interface SoftkeyConfig {
  pages: string[][];
  customKeys: SoftkeyCustomKeySpec[];
  containers?: SoftkeyContainerSpec[];
}

export interface GestureMapping {
  [key: string]: string;
}

export interface SoftkeyKeySettings {
  wheelDelta?: number;
}

export interface Profile {
  name: string;
  fontSize: number;
  fontFamily: string;
  themeLight: string;
  themeDark: string;
  scrollback: number;
  padding: number;
  softkeys?: SoftkeyConfig;
  softkeySize?: number;
  gestures?: GestureMapping;
  softkeySettings?: Record<string, SoftkeyKeySettings>;
  sessionSwitcherHotkey?: string;
  imagePasteDir?: string;
  optionIsMeta: boolean;
  notificationMode: 'iterm' | 'kitty' | 'ghostty' | 'off';
  remoteEditor: boolean;
  copyOnSelect: boolean;
}

// ── Declarative Field Schema ─────────────────────────────────────────────────

interface StringFieldRule {
  readonly type: 'string';
  readonly default: string;
  readonly maxLength: number;
  readonly pattern?: RegExp;
  readonly optional?: true;
  readonly errors: {
    readonly required: string;
    readonly maxLength: string;
    readonly pattern?: string;
  };
}

interface NumberFieldRule {
  readonly type: 'number';
  readonly default: number;
  readonly min: number;
  readonly max: number;
  readonly integer?: true;
  readonly optional?: true;
  readonly errors: {
    readonly type: string;
    readonly range: string;
    readonly integer?: string;
  };
}

interface EnumFieldRule {
  readonly type: 'enum';
  readonly default: string;
  readonly values: readonly string[];
  readonly optional?: true;
  readonly errors: {
    readonly invalid: string;
  };
}

interface BooleanFieldRule {
  readonly type: 'boolean';
  readonly default: boolean;
  readonly errors: {
    readonly type: string;
  };
}

type FieldRule = StringFieldRule | NumberFieldRule | EnumFieldRule | BooleanFieldRule;

export const PROFILE_FIELD_RULES: Readonly<Record<string, FieldRule>> = {
  name: {
    type: 'string',
    default: 'default',
    maxLength: 64,
    pattern: /^[a-zA-Z0-9_-]+$/,
    errors: {
      required: 'Name is required',
      maxLength: 'Must be 64 characters or fewer',
      pattern: 'Only letters, numbers, hyphens, and underscores',
    },
  },
  fontSize: {
    type: 'number',
    default: 13,
    min: 8,
    max: 72,
    errors: {
      type: 'Must be a number',
      range: 'Must be between 8 and 72',
    },
  },
  fontFamily: {
    type: 'string',
    default: '"CaskaydiaCove NFM", monospace',
    maxLength: 256,
    errors: {
      required: 'Font family is required',
      maxLength: 'Must be 256 characters or fewer',
    },
  },
  themeLight: {
    type: 'string',
    default: 'default-light',
    maxLength: 64,
    pattern: /^[a-zA-Z0-9_-]+$/,
    errors: {
      required: 'Theme is required',
      maxLength: 'Must be 64 characters or fewer',
      pattern: 'Only letters, numbers, hyphens, and underscores',
    },
  },
  themeDark: {
    type: 'string',
    default: 'default-dark',
    maxLength: 64,
    pattern: /^[a-zA-Z0-9_-]+$/,
    errors: {
      required: 'Theme is required',
      maxLength: 'Must be 64 characters or fewer',
      pattern: 'Only letters, numbers, hyphens, and underscores',
    },
  },
  scrollback: {
    type: 'number',
    default: 5000,
    min: 100,
    max: 50000,
    integer: true,
    errors: {
      type: 'Must be a number',
      integer: 'Must be a whole number',
      range: 'Must be between 100 and 50,000',
    },
  },
  softkeySize: {
    type: 'number',
    default: 44,
    min: 28,
    max: 60,
    optional: true,
    errors: {
      type: 'Must be a number',
      range: 'Must be between 28 and 60',
    },
  },
  padding: {
    type: 'number',
    default: 4,
    min: 0,
    max: 48,
    errors: {
      type: 'Must be a number',
      range: 'Must be between 0 and 48',
    },
  },
  imagePasteDir: {
    type: 'string',
    default: 'tmp',
    maxLength: 256,
    optional: true,
    errors: {
      required: 'Image paste directory is required',
      maxLength: 'Must be 256 characters or fewer',
    },
  },
  optionIsMeta: {
    type: 'boolean',
    default: true,
    errors: {
      type: 'Must be true or false',
    },
  },
  notificationMode: {
    type: 'enum',
    default: 'ghostty',
    values: ['iterm', 'kitty', 'ghostty', 'off'] as const,
    errors: {
      invalid: 'Must be iterm, kitty, ghostty, or off',
    },
  },
  remoteEditor: {
    type: 'boolean',
    default: false,
    errors: {
      type: 'Must be true or false',
    },
  },
  copyOnSelect: {
    type: 'boolean',
    default: false,
    errors: {
      type: 'Must be true or false',
    },
  },
};

export const SOFTKEY_SETTINGS_FIELD_RULES: Readonly<Record<string, FieldRule>> = {
  wheelDelta: {
    type: 'number',
    default: 100,
    min: 10,
    max: 500,
    integer: true,
    optional: true,
    errors: {
      type: 'Must be a number',
      integer: 'Must be a whole number',
      range: 'Must be between 10 and 500',
    },
  },
};

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_PROFILE_NAMES = new Set(['default-desktop', 'default-mobile']);
export const DEFAULT_SCROLLBACK = 5000;

export const PROFILE_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
export const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
export const CUSTOM_KEY_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

export const BUILTIN_KEY_IDS = new Set([
  'esc', 'tab', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown',
  'wheel_up', 'wheel_down', 'enter', 'space', 'ctrl', 'alt', 'shift',
  'batch_input', 'inline_input', 'paste', 'system_meter',
  'select_line', 'select_visible', 'select_all',
]);

export const VALID_GESTURE_IDS = new Set([
  'swipe-1-left', 'swipe-1-right',
  'flick-1-up', 'flick-1-down', 'flick-1-left', 'flick-1-right',
  'swipe-2-up', 'swipe-2-down', 'swipe-2-left', 'swipe-2-right',
  'swipe-3-up', 'swipe-3-down', 'swipe-3-left', 'swipe-3-right',
  'double-tap',
  'triple-tap',
  'pinch-in',
  'pinch-out',
  'rotate-cw',
  'rotate-ccw',
]);

export const THEME_KEYS: ReadonlyArray<keyof ProfileTheme> = [
  'foreground', 'background', 'cursor',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
];

// ── Schema-Driven Validation ─────────────────────────────────────────────────

export function validateField(rule: FieldRule, value: unknown): string | undefined {
  if (rule.type === 'string') {
    if (typeof value !== 'string' || value.length === 0) return rule.errors.required;
    if (value.length > rule.maxLength) return rule.errors.maxLength;
    if (rule.pattern && !rule.pattern.test(value)) return rule.errors.pattern;
    return undefined;
  }
  if (rule.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return rule.errors.type;
    if (rule.integer && !Number.isInteger(value)) return rule.errors.integer;
    if (value < rule.min || value > rule.max) return rule.errors.range;
    return undefined;
  }
  if (rule.type === 'boolean') {
    if (typeof value !== 'boolean') return rule.errors.type;
    return undefined;
  }
  // enum
  if (typeof value !== 'string') return rule.errors.invalid;
  const valid: readonly string[] = rule.values;
  if (!valid.includes(value)) return rule.errors.invalid;
  return undefined;
}

export type ProfileFieldName = keyof typeof PROFILE_FIELD_RULES;
export type ProfileFieldErrors = Map<ProfileFieldName, string>;

export function validateProfileFields(candidate: Record<string, unknown>): ProfileFieldErrors {
  const errors: ProfileFieldErrors = new Map();
  for (const [field, rule] of Object.entries(PROFILE_FIELD_RULES)) {
    const value = candidate[field];
    if ('optional' in rule && rule.optional && value === undefined) continue;
    const error = validateField(rule, value);
    if (error !== undefined) errors.set(field, error);
  }
  return errors;
}

// ── Theme Validation ─────────────────────────────────────────────────────────

export function isProfileTheme(obj: unknown): obj is ProfileTheme {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  for (const key of THEME_KEYS) {
    const val = record[key];
    if (typeof val !== 'string' || !HEX_COLOR_RE.test(val)) return false;
  }
  return true;
}

// ── Softkey Structural Validation ────────────────────────────────────────────

function isCustomKeySpec(obj: unknown): obj is SoftkeyCustomKeySpec {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || !CUSTOM_KEY_ID_RE.test(r['id'])) return false;
  if (typeof r['label'] !== 'string' || r['label'].length === 0 || r['label'].length > 32) return false;
  if (!Array.isArray(r['combo']) || r['combo'].length === 0 || r['combo'].length > 10) return false;
  for (const step of r['combo'] as unknown[]) {
    if (typeof step !== 'string' || step.length === 0 || step.length > 64) return false;
  }
  return true;
}

function isContainerSpec(obj: unknown): obj is SoftkeyContainerSpec {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || !CUSTOM_KEY_ID_RE.test(r['id'])) return false;
  if (typeof r['label'] !== 'string' || r['label'].length === 0 || r['label'].length > 32) return false;
  if (!Array.isArray(r['keys']) || r['keys'].length > 20) return false;
  for (const key of r['keys'] as unknown[]) {
    if (typeof key !== 'string') return false;
  }
  return true;
}

function isValidKeyId(keyId: unknown, customKeyIds: Set<string>): boolean {
  if (typeof keyId !== 'string') return false;
  if (BUILTIN_KEY_IDS.has(keyId)) return true;
  if (keyId.length === 1) return true;
  if (customKeyIds.has(keyId)) return true;
  return false;
}

function isSoftkeyConfig(obj: unknown, customKeyIds: Set<string>, containerIds: Set<string>): obj is SoftkeyConfig {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  if (!Array.isArray(r['pages']) || r['pages'].length > 10) return false;
  for (const page of r['pages'] as unknown[]) {
    if (!Array.isArray(page) || page.length > 20) return false;
    for (const keyId of page as unknown[]) {
      if (!isValidKeyId(keyId, customKeyIds) && !(typeof keyId === 'string' && containerIds.has(keyId))) return false;
    }
  }
  if (!Array.isArray(r['customKeys']) || r['customKeys'].length > 50) return false;
  for (const ck of r['customKeys'] as unknown[]) {
    if (!isCustomKeySpec(ck)) return false;
  }
  if (r['containers'] !== undefined) {
    if (!Array.isArray(r['containers']) || r['containers'].length > 20) return false;
    for (const c of r['containers'] as unknown[]) {
      if (!isContainerSpec(c)) return false;
      const cId = (c as SoftkeyContainerSpec).id;
      if (BUILTIN_KEY_IDS.has(cId) || customKeyIds.has(cId)) return false;
      for (const childKey of (c as SoftkeyContainerSpec).keys) {
        if (containerIds.has(childKey)) return false;
        if (!isValidKeyId(childKey, customKeyIds)) return false;
      }
    }
  }
  return true;
}

// ── Gesture Validation ───────────────────────────────────────────────────────

export function isGestureMapping(obj: unknown, customKeyIds: Set<string>): obj is GestureMapping {
  if (typeof obj !== 'object' || obj === null) return false;
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length > 27) return false;
  for (const [key, value] of entries) {
    if (!VALID_GESTURE_IDS.has(key)) continue;
    if (typeof value !== 'string') return false;
    if (!BUILTIN_KEY_IDS.has(value) && value.length !== 1 && !customKeyIds.has(value)) return false;
  }
  return true;
}

// ── Softkey Settings Validation ─────────────────────────────────────────────

function isSoftkeyKeySettings(obj: unknown): obj is SoftkeyKeySettings {
  if (typeof obj !== 'object' || obj === null) return false;
  const r = obj as Record<string, unknown>;
  for (const [field, rule] of Object.entries(SOFTKEY_SETTINGS_FIELD_RULES)) {
    const value = r[field];
    if (value === undefined) continue;
    if (validateField(rule, value) !== undefined) return false;
  }
  return true;
}

function isSoftkeySettings(obj: unknown): obj is Record<string, SoftkeyKeySettings> {
  if (typeof obj !== 'object' || obj === null) return false;
  const entries = Object.entries(obj as Record<string, unknown>);
  if (entries.length > 50) return false;
  for (const [, value] of entries) {
    if (!isSoftkeyKeySettings(value)) return false;
  }
  return true;
}

// ── Hotkey Validation ───────────────────────────────────────────────────────

export function validateHotkeyString(input: string): string | null {
  if (input === '') return null;
  if (/[,\s]/.test(input)) return 'Hotkey must be a single key combination';
  const parts = input.split('+').map(p => p.trim()).filter(p => p.length > 0);
  if (parts.length === 0) return 'Invalid hotkey';
  let hasMainKey = false;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'ctrl' || lower === 'alt' || lower === 'shift') continue;
    if (/^(control|meta|super|win|cmd|command|option)$/i.test(lower)) {
      return `Unknown modifier '${part}'`;
    }
    if (hasMainKey) return 'Only one main key allowed';
    hasMainKey = true;
  }
  if (!hasMainKey) return 'Missing key after modifier(s)';
  return null;
}

// ── Combined Profile Validation ──────────────────────────────────────────────

function collectKeyIds(softkeys: unknown): { customKeyIds: Set<string>; containerIds: Set<string> } {
  const customKeyIds = new Set<string>();
  const containerIds = new Set<string>();
  if (typeof softkeys !== 'object' || softkeys === null) return { customKeyIds, containerIds };
  const cfg = softkeys as Record<string, unknown>;
  const arr = cfg['customKeys'];
  if (Array.isArray(arr)) {
    for (const ck of arr) {
      if (typeof ck === 'object' && ck !== null) {
        const id = (ck as Record<string, unknown>)['id'];
        if (typeof id === 'string') customKeyIds.add(id);
      }
    }
  }
  const containers = cfg['containers'];
  if (Array.isArray(containers)) {
    for (const c of containers) {
      if (typeof c === 'object' && c !== null) {
        const id = (c as Record<string, unknown>)['id'];
        if (typeof id === 'string') containerIds.add(id);
      }
    }
  }
  return { customKeyIds, containerIds };
}

export function isProfile(obj: unknown): obj is Profile {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  for (const [field, rule] of Object.entries(PROFILE_FIELD_RULES)) {
    const value = record[field];
    if ('optional' in rule && rule.optional && value === undefined) continue;
    if (validateField(rule, value) !== undefined) return false;
  }
  if (record['softkeys'] !== undefined) {
    const { customKeyIds, containerIds } = collectKeyIds(record['softkeys']);
    if (!isSoftkeyConfig(record['softkeys'], customKeyIds, containerIds)) return false;
  }
  if (record['gestures'] !== undefined) {
    const { customKeyIds } = collectKeyIds(record['softkeys']);
    if (!isGestureMapping(record['gestures'], customKeyIds)) return false;
  }
  if (record['softkeySettings'] !== undefined && !isSoftkeySettings(record['softkeySettings'])) return false;
  if (record['sessionSwitcherHotkey'] !== undefined) {
    if (typeof record['sessionSwitcherHotkey'] !== 'string') return false;
    if (record['sessionSwitcherHotkey'] !== '' && validateHotkeyString(record['sessionSwitcherHotkey']) !== null) return false;
  }
  return true;
}

export function isProfileName(name: unknown): name is string {
  return typeof name === 'string' && PROFILE_NAME_RE.test(name);
}
