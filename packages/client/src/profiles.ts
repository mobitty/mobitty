import { DEFAULT_GESTURE_MAPPING } from './gesture-types';
import {
  DEFAULT_MOBILE_PAGES, DEFAULT_MOBILE_CUSTOM_KEYS, DEFAULT_MOBILE_CONTAINERS,
  DEFAULT_DESKTOP_PAGES,
} from './softkey-types';
import {
  isProfile, isProfileName,
  DEFAULT_PROFILE_NAME, DEFAULT_SCROLLBACK,
} from './profile-schema';
import type { Profile, ProfileSoftkeys, GestureMapping, SoftkeyKeySettings } from './profile-schema';

export type {
  ProfileTheme, ProfileThemeMap, SoftkeyCustomKeySpec, SoftkeyContainerSpec, SoftkeyConfig,
  ProfileSoftkeys, GestureMapping, SoftkeyKeySettings, Profile, ProfileFieldName, ProfileFieldErrors,
} from './profile-schema';

export {
  isProfile, isProfileTheme, isProfileName, isGestureMapping,
  validateField, validateProfileFields, validateHotkeyString,
  PROFILE_FIELD_RULES, SOFTKEY_SETTINGS_FIELD_RULES,
  PROFILE_NAME_RE, HEX_COLOR_RE, CUSTOM_KEY_ID_RE,
  BUILTIN_KEY_IDS, VALID_GESTURE_IDS, THEME_KEYS,
  DEFAULT_PROFILE_NAME, DEFAULT_SCROLLBACK,
} from './profile-schema';

// ── Default Profile (single source of truth) ────────────────────────────────

export const DEFAULT_SOFTKEYS: ProfileSoftkeys = {
  mobile: { pages: DEFAULT_MOBILE_PAGES.map(p => [...p]), customKeys: [...DEFAULT_MOBILE_CUSTOM_KEYS], containers: [...DEFAULT_MOBILE_CONTAINERS] },
  desktop: { pages: DEFAULT_DESKTOP_PAGES.map(p => [...p]), customKeys: [], containers: [] },
};

export const DEFAULT_GESTURES: GestureMapping = { ...DEFAULT_GESTURE_MAPPING };

export const DEFAULT_SOFTKEY_SETTINGS: Record<string, SoftkeyKeySettings> = {
  wheel_up: { wheelDelta: 100 },
  wheel_down: { wheelDelta: 100 },
};

export const DEFAULT_PROFILE: Profile = {
  name: DEFAULT_PROFILE_NAME,
  fontSize: { mobile: 10, desktop: 13 },
  fontFamily: '"CaskaydiaCove NFM", monospace',
  theme: {
    desktopLight: 'default-light',
    desktopDark: 'default-dark',
    mobileLight: 'default-light',
    mobileDark: 'default-dark',
  },
  scrollback: DEFAULT_SCROLLBACK,
  padding: { mobile: 4, desktop: 4 },
  softkeySize: 44,
  softkeys: DEFAULT_SOFTKEYS,
  gestures: DEFAULT_GESTURES,
  softkeySettings: DEFAULT_SOFTKEY_SETTINGS,
  imagePasteDir: 'tmp',
  optionIsMeta: true,
  notificationMode: 'iterm',
  remoteEditor: false,
};

// ── localStorage ─────────────────────────────────────────────────────────────

const STORAGE_KEY = 'mobitty-profile';

export function getSelectedProfileName(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null && isProfileName(stored)) return stored;
  } catch {
    // localStorage may be unavailable
  }
  return 'default';
}

export function setSelectedProfileName(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // localStorage may be unavailable
  }
}

// ── Profile cache ────────────────────────────────────────────────────────────

const CACHE_KEY_PREFIX = 'mobitty-profile-cache:';

export function getCachedProfile(name: string): Profile | undefined {
  try {
    const raw = localStorage.getItem(CACHE_KEY_PREFIX + name);
    if (raw === null) return undefined;
    const data: unknown = JSON.parse(raw);
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

function migrateProfile(data: Record<string, unknown>): void {
  if (typeof data['theme'] === 'string') {
    const old = data['theme'];
    if (old === 'default') {
      data['theme'] = {
        desktopLight: 'default-light',
        desktopDark: 'default-dark',
        mobileLight: 'default-light',
        mobileDark: 'default-dark',
      };
    } else {
      data['theme'] = {
        desktopLight: old,
        desktopDark: old,
        mobileLight: old,
        mobileDark: old,
      };
    }
  }
}

export async function fetchProfile(name: string): Promise<Profile | undefined> {
  if (name === DEFAULT_PROFILE_NAME) return DEFAULT_PROFILE;
  const resp = await fetch(buildApiUrl(`/api/profiles/${encodeURIComponent(name)}`));
  if (!resp.ok) return undefined;
  const data = await resp.json() as Record<string, unknown>;
  migrateProfile(data);
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
