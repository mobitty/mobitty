import { DEFAULT_GESTURE_MAPPING } from './gesture-types';
import {
  DEFAULT_MOBILE_PAGES, DEFAULT_MOBILE_CUSTOM_KEYS, DEFAULT_MOBILE_CONTAINERS,
  DEFAULT_DESKTOP_PAGES,
} from './softkey-types';
import {
  isProfile, isProfileName,
  DEFAULT_SCROLLBACK,
} from './profile-schema';
import type { Profile, SoftkeyKeySettings } from './profile-schema';

export type {
  ProfileTheme, SoftkeyCustomKeySpec, SoftkeyContainerSpec, SoftkeyConfig,
  GestureMapping, SoftkeyKeySettings, Profile, ProfileFieldName, ProfileFieldErrors,
} from './profile-schema';

export {
  isProfile, isProfileTheme, isProfileName, isGestureMapping,
  validateField, validateProfileFields, validateHotkeyString,
  PROFILE_FIELD_RULES, SOFTKEY_SETTINGS_FIELD_RULES,
  PROFILE_NAME_RE, HEX_COLOR_RE, CUSTOM_KEY_ID_RE,
  BUILTIN_KEY_IDS, VALID_GESTURE_IDS, THEME_KEYS,
  DEFAULT_PROFILE_NAMES, DEFAULT_SCROLLBACK,
} from './profile-schema';

// ── Default Profiles (single source of truth) ──────────────────────────────

export const DEFAULT_SOFTKEY_SETTINGS: Record<string, SoftkeyKeySettings> = {
  wheel_up: { wheelDelta: 100 },
  wheel_down: { wheelDelta: 100 },
};

export const DEFAULT_DESKTOP_PROFILE: Profile = {
  name: 'default-desktop',
  fontSize: 13,
  fontFamily: '"CaskaydiaCove NFM", monospace',
  themeLight: 'default-light',
  themeDark: 'default-dark',
  scrollback: DEFAULT_SCROLLBACK,
  padding: 4,
  softkeySize: 44,
  softkeys: { pages: DEFAULT_DESKTOP_PAGES.map(p => [...p]), customKeys: [], containers: [] },
  softkeySettings: { ...DEFAULT_SOFTKEY_SETTINGS },
  sessionSwitcherHotkey: 'Ctrl+Shift+s',
  copyHotkey: 'default',
  pasteHotkey: 'default',
  imagePasteDir: 'tmp',
  optionIsMeta: true,
  notificationMode: 'ghostty',
  remoteEditor: false,
  copyOnSelect: false,
};

export const DEFAULT_MOBILE_PROFILE: Profile = {
  name: 'default-mobile',
  fontSize: 10,
  fontFamily: '"CaskaydiaCove NFM", monospace',
  themeLight: 'default-light',
  themeDark: 'default-dark',
  scrollback: DEFAULT_SCROLLBACK,
  padding: 4,
  softkeySize: 44,
  softkeys: { pages: DEFAULT_MOBILE_PAGES.map(p => [...p]), customKeys: [...DEFAULT_MOBILE_CUSTOM_KEYS], containers: [...DEFAULT_MOBILE_CONTAINERS] },
  gestures: { ...DEFAULT_GESTURE_MAPPING },
  softkeySettings: { ...DEFAULT_SOFTKEY_SETTINGS },
  sessionSwitcherHotkey: 'Ctrl+Shift+s',
  copyHotkey: 'default',
  pasteHotkey: 'default',
  imagePasteDir: 'tmp',
  optionIsMeta: true,
  notificationMode: 'ghostty',
  remoteEditor: true,
  copyOnSelect: false,
};

// ── localStorage ─────────────────────────────────────────────────────────────

const STORAGE_KEY_DESKTOP = 'mobitty-profile-desktop';
const STORAGE_KEY_MOBILE = 'mobitty-profile-mobile';

export function getSelectedProfileName(device: 'desktop' | 'mobile'): string {
  const key = device === 'desktop' ? STORAGE_KEY_DESKTOP : STORAGE_KEY_MOBILE;
  try {
    const stored = localStorage.getItem(key);
    if (stored !== null && isProfileName(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return device === 'desktop' ? 'default-desktop' : 'default-mobile';
}

export function setSelectedProfileName(device: 'desktop' | 'mobile', name: string): void {
  const key = device === 'desktop' ? STORAGE_KEY_DESKTOP : STORAGE_KEY_MOBILE;
  try {
    localStorage.setItem(key, name);
  } catch {
    // localStorage may be unavailable
  }
}

// ── Profile cache ────────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'mobitty-profile-cache:';

function backfillHotkeys(data: unknown): void {
  if (typeof data !== 'object' || data === null) return;
  const r = data as Record<string, unknown>;
  if (typeof r['copyHotkey'] !== 'string') r['copyHotkey'] = 'default';
  if (typeof r['pasteHotkey'] !== 'string') r['pasteHotkey'] = 'default';
}

export function getCachedProfile(name: string): Profile | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + name);
    if (raw === null) return undefined;
    const data: unknown = JSON.parse(raw);
    backfillHotkeys(data);
    if (isProfile(data)) return data;
    localStorage.removeItem(CACHE_KEY_PREFIX + name);
  } catch { /* localStorage unavailable */ }
  return undefined;
}

function cacheProfile(profile: Profile): void {
  try {
    localStorage.setItem(CACHE_KEY_PREFIX + profile.name, JSON.stringify(profile));
  } catch { /* full or unavailable */ }
}

function clearCachedProfile(name: string): void {
  try {
    localStorage.removeItem(CACHE_KEY_PREFIX + name);
  } catch { /* unavailable */ }
}

// ── API ──────────────────────────────────────────────────────────────────────

function buildApiUrl(path: string): string {
  const base = window.location.pathname.replace(/[/]+$/, '');
  return `${window.location.protocol}//${window.location.host}${base}${path}`;
}

export async function fetchProfileList(): Promise<string[]> {
  const resp = await fetch(buildApiUrl('/api/profiles'));
  if (!resp.ok) return [];
  const data = await resp.json() as Record<string, unknown>;
  if (Array.isArray(data['profiles'])) {
    return (data['profiles'] as unknown[]).filter((p): p is string => typeof p === 'string');
  }
  return [];
}

export async function fetchProfile(name: string): Promise<Profile | undefined> {
  if (name === 'default-desktop') return DEFAULT_DESKTOP_PROFILE;
  if (name === 'default-mobile') return DEFAULT_MOBILE_PROFILE;
  const resp = await fetch(buildApiUrl(`/api/profiles/${encodeURIComponent(name)}`));
  if (!resp.ok) return undefined;
  const data = await resp.json() as Record<string, unknown>;
  backfillHotkeys(data);
  if (isProfile(data)) {
    cacheProfile(data);
    return data;
  }
  return undefined;
}

export async function saveProfile(profile: Profile): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/profiles/${encodeURIComponent(profile.name)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(profile),
  });
  if (resp.ok) cacheProfile(profile);
  return resp.ok;
}

export async function deleteProfile(name: string): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/profiles/${encodeURIComponent(name)}`), {
    method: 'DELETE',
  });
  if (resp.ok) clearCachedProfile(name);
  return resp.ok;
}
