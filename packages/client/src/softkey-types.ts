// Softkey types, key registry, and helpers — shared by SoftkeyBar, settings, profiles

export interface ModifierFlags {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

export type VirtualKey = 'esc' | 'tab' | 'up' | 'down' | 'left' | 'right' | 'home' | 'end' | 'pageup' | 'pagedown';

export type RepeatPolicy = { kind: 'none' } | { kind: 'hold'; interval: 'default' | 'wheel' };

export type ComboStep =
  | { kind: 'virtual'; key: VirtualKey; modifiers: ModifierFlags }
  | { kind: 'char'; char: string; modifiers: ModifierFlags };

export type KeyBehavior =
  | { kind: 'send-virtual'; key: VirtualKey }
  | { kind: 'send-char'; char: string }
  | { kind: 'send-combo'; combo: ComboStep[] }
  | { kind: 'wheel-step'; direction: 1 | -1 }
  | { kind: 'toggle-modifier'; modifier: keyof ModifierFlags }
  | { kind: 'batch-input-toggle' }
  | { kind: 'inline-input' }
  | { kind: 'meter-toggle' }
  | { kind: 'container-toggle'; containerId: string };

export interface KeySpec {
  id: string;
  label: string;
  behavior: KeyBehavior;
  repeat: RepeatPolicy;
  consumesModifiers: boolean;
}

export type ModifierKey = 'ctrl' | 'alt' | 'shift';

export const MODIFIER_KEYS: ModifierKey[] = ['ctrl', 'alt', 'shift'];

export function emptyModifiers(): ModifierFlags {
  return { ctrl: false, alt: false, shift: false };
}

// --- Key spec factories ---

function virtualKeySpec(id: string, label: string, key: VirtualKey, repeat: RepeatPolicy): KeySpec {
  return { id, label, behavior: { kind: 'send-virtual', key }, repeat, consumesModifiers: true };
}

function charKeySpec(id: string, label: string, char: string): KeySpec {
  return { id, label, behavior: { kind: 'send-char', char }, repeat: { kind: 'none' }, consumesModifiers: true };
}

// --- Key registry ---

export const KEY_REGISTRY: Record<string, KeySpec> = {
  esc: virtualKeySpec('esc', 'Esc', 'esc', { kind: 'none' }),
  tab: virtualKeySpec('tab', 'Tab', 'tab', { kind: 'none' }),
  up: virtualKeySpec('up', '\u2191', 'up', { kind: 'hold', interval: 'default' }),
  down: virtualKeySpec('down', '\u2193', 'down', { kind: 'hold', interval: 'default' }),
  left: virtualKeySpec('left', '\u2190', 'left', { kind: 'hold', interval: 'default' }),
  right: virtualKeySpec('right', '\u2192', 'right', { kind: 'hold', interval: 'default' }),
  home: virtualKeySpec('home', 'Home', 'home', { kind: 'none' }),
  end: virtualKeySpec('end', 'End', 'end', { kind: 'none' }),
  pageup: virtualKeySpec('pageup', 'PgUp', 'pageup', { kind: 'none' }),
  pagedown: virtualKeySpec('pagedown', 'PgDn', 'pagedown', { kind: 'none' }),
  wheel_up: { id: 'wheel_up', label: 'W\u2191', behavior: { kind: 'wheel-step', direction: -1 }, repeat: { kind: 'hold', interval: 'wheel' }, consumesModifiers: false },
  wheel_down: { id: 'wheel_down', label: 'W\u2193', behavior: { kind: 'wheel-step', direction: 1 }, repeat: { kind: 'hold', interval: 'wheel' }, consumesModifiers: false },
  enter: charKeySpec('enter', '\u23CE', '\r'),
  space: charKeySpec('space', 'Spc', ' '),
  ctrl: { id: 'ctrl', label: 'Ctrl', behavior: { kind: 'toggle-modifier', modifier: 'ctrl' }, repeat: { kind: 'none' }, consumesModifiers: false },
  alt: { id: 'alt', label: 'Alt', behavior: { kind: 'toggle-modifier', modifier: 'alt' }, repeat: { kind: 'none' }, consumesModifiers: false },
  shift: { id: 'shift', label: 'Shift', behavior: { kind: 'toggle-modifier', modifier: 'shift' }, repeat: { kind: 'none' }, consumesModifiers: false },
  batch_input: { id: 'batch_input', label: 'Input', behavior: { kind: 'batch-input-toggle' }, repeat: { kind: 'none' }, consumesModifiers: false },
  inline_input: { id: 'inline_input', label: 'Input', behavior: { kind: 'inline-input' }, repeat: { kind: 'none' }, consumesModifiers: false },
  system_meter: { id: 'system_meter', label: 'Meter', behavior: { kind: 'meter-toggle' }, repeat: { kind: 'none' }, consumesModifiers: false },
};

import { BUILTIN_KEY_IDS } from './profile-schema';
export { BUILTIN_KEY_IDS };

// Single-character keys that can appear in softkey pages
export function builtinCharKeySpec(keyId: string): KeySpec | null {
  if (keyId.length === 1) {
    return charKeySpec(keyId, keyId, keyId);
  }
  return null;
}

export function getKeySpec(keyId: string, customKeys?: Map<string, KeySpec>): KeySpec {
  const reg = KEY_REGISTRY[keyId];
  if (reg) return reg;
  const custom = customKeys?.get(keyId);
  if (custom) return custom;
  const charSpec = builtinCharKeySpec(keyId);
  if (charSpec) return charSpec;
  return KEY_REGISTRY['esc']!;
}

// --- Custom key helpers ---

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

const VIRTUAL_KEYS_SET = new Set<string>(['esc', 'tab', 'up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown']);

const VIRTUAL_KEY_EVENT_MAP: Record<VirtualKey, string> = {
  esc: 'Escape', tab: 'Tab',
  up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};

export function matchComboEvent(combo: ComboStep, event: KeyboardEvent): boolean {
  if (event.ctrlKey !== combo.modifiers.ctrl) return false;
  if (event.altKey !== combo.modifiers.alt) return false;
  if (event.shiftKey !== combo.modifiers.shift) return false;
  if (combo.kind === 'virtual') {
    return event.key === VIRTUAL_KEY_EVENT_MAP[combo.key];
  }
  return event.key.toLowerCase() === combo.char.toLowerCase();
}

export function parseComboString(step: string): ComboStep | null {
  const parts = step.split('+');
  const modifiers = emptyModifiers();
  let mainKey = '';

  for (const part of parts) {
    const lower = part.toLowerCase().trim();
    if (lower === 'ctrl') modifiers.ctrl = true;
    else if (lower === 'alt') modifiers.alt = true;
    else if (lower === 'shift') modifiers.shift = true;
    else mainKey = part;
  }

  if (mainKey === '') return null;

  if (VIRTUAL_KEYS_SET.has(mainKey.toLowerCase())) {
    return { kind: 'virtual', key: mainKey.toLowerCase() as VirtualKey, modifiers };
  }

  return { kind: 'char', char: mainKey, modifiers };
}

export function parseCustomKeySpec(spec: SoftkeyCustomKeySpec): KeySpec | null {
  const combo: ComboStep[] = [];
  for (const step of spec.combo) {
    const parsed = parseComboString(step);
    if (!parsed) return null;
    combo.push(parsed);
  }
  if (combo.length === 0) return null;
  return {
    id: spec.id,
    label: spec.label,
    behavior: { kind: 'send-combo', combo },
    repeat: { kind: 'none' },
    consumesModifiers: false,
  };
}

export function buildCustomKeyMap(specs: SoftkeyCustomKeySpec[]): Map<string, KeySpec> {
  const map = new Map<string, KeySpec>();
  for (const spec of specs) {
    const parsed = parseCustomKeySpec(spec);
    if (parsed) map.set(spec.id, parsed);
  }
  return map;
}

export function buildContainerKeyMap(specs: SoftkeyContainerSpec[]): Map<string, KeySpec> {
  const map = new Map<string, KeySpec>();
  for (const spec of specs) {
    map.set(spec.id, {
      id: spec.id,
      label: spec.label,
      behavior: { kind: 'container-toggle', containerId: spec.id },
      repeat: { kind: 'none' },
      consumesModifiers: false,
    });
  }
  return map;
}

export function mergeKeyMaps(...maps: Map<string, KeySpec>[]): Map<string, KeySpec> {
  const merged = new Map<string, KeySpec>();
  for (const m of maps) {
    for (const [k, v] of m) merged.set(k, v);
  }
  return merged;
}

// --- Default page configurations ---

export const DEFAULT_MOBILE_CUSTOM_KEYS: SoftkeyCustomKeySpec[] = [
  { id: 'ctrl_c', label: 'C-c', combo: ['Ctrl+c'] },
];

export const DEFAULT_MOBILE_CONTAINERS: SoftkeyContainerSpec[] = [
  { id: 'extra', label: 'Extra', keys: ['system_meter', 'ctrl_c', 'home', 'end', 'up', 'down', 'left', 'right'] },
];

export const DEFAULT_MOBILE_PAGES: string[][] = [
  ['esc', 'ctrl', 'alt', 'shift', 'tab', 'batch_input', 'extra'],
];

export const DEFAULT_DESKTOP_PAGES: string[][] = [['system_meter', 'inline_input']];

// --- Key ID validation ---

export function isValidKeyId(keyId: string, customKeyIds?: Set<string>, containerIds?: Set<string>): boolean {
  if (BUILTIN_KEY_IDS.has(keyId)) return true;
  if (keyId.length === 1) return true;
  if (customKeyIds?.has(keyId)) return true;
  if (containerIds?.has(keyId)) return true;
  return false;
}

// --- Round-trip serialization & validation ---

export function comboStepToString(step: ComboStep): string {
  const parts: string[] = [];
  if (step.modifiers.ctrl) parts.push('Ctrl');
  if (step.modifiers.alt) parts.push('Alt');
  if (step.modifiers.shift) parts.push('Shift');
  if (step.kind === 'virtual') parts.push(step.key);
  else parts.push(step.char);
  return parts.join('+');
}

export function comboToDisplayString(combo: string[]): string {
  return combo.map(step => {
    const parsed = parseComboString(step);
    if (parsed) return comboStepToString(parsed);
    return step;
  }).join(', ');
}

export function validateComboString(input: string): string | null {
  const steps = input.split(/[,\s]+/).filter(s => s.length > 0);
  if (steps.length === 0) return 'At least one key step is required';
  for (const step of steps) {
    const parts = step.split('+').map(p => p.trim()).filter(p => p.length > 0);
    if (parts.length === 0) continue;
    let hasMainKey = false;
    for (const part of parts) {
      const lower = part.toLowerCase();
      if (lower === 'ctrl' || lower === 'alt' || lower === 'shift') continue;
      if (/^(control|meta|super|win|cmd|command|option)$/i.test(lower)) {
        return `Unknown modifier '${part}'`;
      }
      hasMainKey = true;
    }
    if (!hasMainKey) return 'Missing key after modifier(s)';
  }
  return null;
}
