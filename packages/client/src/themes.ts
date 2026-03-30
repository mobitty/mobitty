import type { ProfileTheme } from './profiles';

export interface Theme {
  name: string;
  colors: ProfileTheme;
}

const THEME_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

const THEME_COLOR_KEYS: ReadonlyArray<keyof ProfileTheme> = [
  'foreground', 'background', 'cursor',
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow', 'brightBlue',
  'brightMagenta', 'brightCyan', 'brightWhite',
];

export function isTheme(obj: unknown): obj is Theme {
  if (typeof obj !== 'object' || obj === null) return false;
  const record = obj as Record<string, unknown>;
  if (typeof record['name'] !== 'string' || !THEME_NAME_RE.test(record['name'])) return false;
  const colors = record['colors'];
  if (typeof colors !== 'object' || colors === null) return false;
  const c = colors as Record<string, unknown>;
  for (const key of THEME_COLOR_KEYS) {
    if (typeof c[key] !== 'string' || !HEX_COLOR_RE.test(c[key])) return false;
  }
  return true;
}

// ── Built-in Theme Names & Credits ──────────────────────────────────────────

/** All built-in theme names (including the 'default' auto-alias). */
export const BUILTIN_THEME_NAMES: ReadonlySet<string> = new Set([
  'default',
  'default-dark',
  'default-light',
  'solarized-dark',
  'solarized-light',
  'dracula',
  'nord',
  'gruvbox-dark',
  'gruvbox-light',
  'catppuccin-mocha',
  'catppuccin-latte',
  'tokyo-night',
  'one-dark',
  'tango-dark',
  'tango-light',
]);

export function isBuiltinTheme(name: string): boolean {
  return BUILTIN_THEME_NAMES.has(name);
}

interface ThemeCredit {
  label: string;
  url: string;
}

const BUILTIN_THEME_CREDITS: ReadonlyMap<string, ThemeCredit> = new Map([
  ['solarized-dark', { label: 'Solarized by Ethan Schoonover', url: 'https://ethanschoonover.com/solarized/' }],
  ['solarized-light', { label: 'Solarized by Ethan Schoonover', url: 'https://ethanschoonover.com/solarized/' }],
  ['dracula', { label: 'Dracula Theme', url: 'https://draculatheme.com' }],
  ['nord', { label: 'Nord Theme', url: 'https://www.nordtheme.com' }],
  ['gruvbox-dark', { label: 'Gruvbox by morhetz', url: 'https://github.com/morhetz/gruvbox' }],
  ['gruvbox-light', { label: 'Gruvbox by morhetz', url: 'https://github.com/morhetz/gruvbox' }],
  ['catppuccin-mocha', { label: 'Catppuccin', url: 'https://catppuccin.com' }],
  ['catppuccin-latte', { label: 'Catppuccin', url: 'https://catppuccin.com' }],
  ['tokyo-night', { label: 'Tokyo Night by Enkia', url: 'https://github.com/enkia/tokyo-night-vscode-theme' }],
  ['one-dark', { label: 'One Dark (Atom)', url: 'https://github.com/atom/one-dark-syntax' }],
  ['tango-dark', { label: 'Tango (freedesktop.org)', url: 'https://freedesktop.org' }],
  ['tango-light', { label: 'Tango (freedesktop.org)', url: 'https://freedesktop.org' }],
]);

export function getThemeCredit(name: string): ThemeCredit | undefined {
  return BUILTIN_THEME_CREDITS.get(name);
}

// ── Auto-Resolution ─────────────────────────────────────────────────────────

/**
 * Resolve 'default' to 'default-dark' or 'default-light' based on OS
 * color scheme preference. All other names pass through unchanged.
 */
export function resolveThemeName(name: string): string {
  if (name !== 'default') return name;
  try {
    return window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'default-light'
      : 'default-dark';
  } catch {
    return 'default-dark';
  }
}

// ── API ─────────────────────────────────────────────────────────────────────

function buildApiUrl(path: string): string {
  const base = window.location.pathname.replace(/[/]+$/, '');
  return `${window.location.protocol}//${window.location.host}${base}${path}`;
}

export async function fetchThemeList(): Promise<string[]> {
  const resp = await fetch(buildApiUrl('/api/themes'));
  if (!resp.ok) return [];
  const data = await resp.json() as Record<string, unknown>;
  if (Array.isArray(data['themes'])) {
    return (data['themes'] as unknown[]).filter(
      (t): t is string => typeof t === 'string' && t !== 'default',
    );
  }
  return [];
}

export async function fetchTheme(name: string): Promise<Theme | undefined> {
  // Resolve 'default' to the OS-appropriate variant
  const resolved = resolveThemeName(name);
  const resp = await fetch(buildApiUrl(`/api/themes/${encodeURIComponent(resolved)}`));
  if (!resp.ok) return undefined;
  const data: unknown = await resp.json();
  if (isTheme(data)) return data;
  return undefined;
}

export async function saveTheme(theme: Theme): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/themes/${encodeURIComponent(theme.name)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(theme),
  });
  return resp.ok;
}

export async function deleteTheme(name: string): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/themes/${encodeURIComponent(name)}`), {
    method: 'DELETE',
  });
  return resp.ok;
}
