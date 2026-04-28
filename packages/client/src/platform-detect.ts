export type OS = 'windows' | 'macos' | 'linux' | 'ios' | 'android' | 'unknown';

export const HOTKEY_DEFAULT = 'default';

export interface DefaultHotkeys {
  copy: string | null;
  paste: string | null;
}

export function detectOS(ua: string = navigator.userAgent): OS {
  if (/iPhone|iPad|iPod/.test(ua)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  if (/Windows/.test(ua)) return 'windows';
  if (/Mac OS X|Macintosh/.test(ua)) return 'macos';
  if (/Linux|X11/.test(ua)) return 'linux';
  return 'unknown';
}

export function defaultHotkeysForOS(os: OS): DefaultHotkeys {
  if (os === 'windows') return { copy: 'Ctrl+Shift+z', paste: 'Ctrl+Shift+x' };
  return { copy: null, paste: null };
}

export type HotkeyKind = 'copy' | 'paste';

export function resolveHotkey(value: string, kind: HotkeyKind, os: OS): string | null {
  if (value === HOTKEY_DEFAULT) return defaultHotkeysForOS(os)[kind];
  if (value === '') return null;
  return value;
}

export function describeHotkey(value: string, kind: HotkeyKind): string {
  if (value === HOTKEY_DEFAULT) {
    const resolved = resolveHotkey(value, kind, detectOS());
    return resolved === null ? 'Default (none)' : `Default (${resolved})`;
  }
  if (value === '') return 'None';
  return value;
}

interface KeyEventLike {
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const VIRTUAL_KEY_MAP: Record<string, string> = {
  Escape: 'esc',
  Tab: 'tab',
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Home: 'home',
  End: 'end',
  PageUp: 'pageup',
  PageDown: 'pagedown',
};

export function eventToComboString(e: KeyEventLike): string | null {
  if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') return null;
  if (e.metaKey) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const virtual = VIRTUAL_KEY_MAP[e.key];
  const main = virtual ?? (e.key.length === 1 ? e.key.toLowerCase() : null);
  if (main === null) return null;
  parts.push(main);
  return parts.join('+');
}
