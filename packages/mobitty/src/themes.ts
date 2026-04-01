import { mkdirSync, readFileSync, writeFileSync, unlinkSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const THEME_NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;

// ── Built-in Theme Colors ───────────────────────────────────────────────────

interface ThemeColors {
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

interface BuiltinThemeEntry {
  colors: ThemeColors;
  credit?: { label: string; url: string };
}

const BUILTIN_ENTRIES: ReadonlyArray<[string, BuiltinThemeEntry]> = [
  ['default-dark', {
    colors: {
      foreground: '#d2d2d2', background: '#2b2b2b', cursor: '#adadad',
      black: '#000000', red: '#d81e00', green: '#5ea702', yellow: '#cfae00',
      blue: '#427ab3', magenta: '#89658e', cyan: '#00a7aa', white: '#dbded8',
      brightBlack: '#686a66', brightRed: '#f54235', brightGreen: '#99e343', brightYellow: '#fdeb61',
      brightBlue: '#84b0d8', brightMagenta: '#bc94b7', brightCyan: '#37e6e8', brightWhite: '#f1f1f0',
    },
  }],
  ['default-light', {
    colors: {
      foreground: '#1a1a1a', background: '#f5f5f5', cursor: '#4d4d4d',
      black: '#1a1a1a', red: '#c42e1a', green: '#417e00', yellow: '#a58600',
      blue: '#2e6bab', magenta: '#7a5480', cyan: '#008e91', white: '#d4d4d4',
      brightBlack: '#808080', brightRed: '#e34c3a', brightGreen: '#66a82b', brightYellow: '#b89e00',
      brightBlue: '#5c96cc', brightMagenta: '#a87aac', brightCyan: '#00b0b3', brightWhite: '#f0f0f0',
    },
  }],
  ['solarized-dark', {
    colors: {
      foreground: '#839496', background: '#002b36', cursor: '#839496',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
    credit: { label: 'Solarized by Ethan Schoonover', url: 'https://ethanschoonover.com/solarized/' },
  }],
  ['solarized-light', {
    colors: {
      foreground: '#657b83', background: '#fdf6e3', cursor: '#657b83',
      black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900',
      blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
      brightBlack: '#586e75', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83',
      brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
    },
    credit: { label: 'Solarized by Ethan Schoonover', url: 'https://ethanschoonover.com/solarized/' },
  }],
  ['dracula', {
    colors: {
      foreground: '#f8f8f2', background: '#282a36', cursor: '#f8f8f2',
      black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c',
      blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
      brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5',
      brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
    },
    credit: { label: 'Dracula Theme', url: 'https://draculatheme.com' },
  }],
  ['nord', {
    colors: {
      foreground: '#d8dee9', background: '#2e3440', cursor: '#eceff4',
      black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b',
      blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
      brightBlack: '#596377', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b',
      brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
    },
    credit: { label: 'Nord Theme', url: 'https://www.nordtheme.com' },
  }],
  ['gruvbox-dark', {
    colors: {
      foreground: '#ebdbb2', background: '#282828', cursor: '#ebdbb2',
      black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
      brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f',
      brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
    },
    credit: { label: 'Gruvbox by morhetz', url: 'https://github.com/morhetz/gruvbox' },
  }],
  ['gruvbox-light', {
    colors: {
      foreground: '#3c3836', background: '#fbf1c7', cursor: '#3c3836',
      black: '#fbf1c7', red: '#cc241d', green: '#98971a', yellow: '#d79921',
      blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#7c6f64',
      brightBlack: '#928374', brightRed: '#9d0006', brightGreen: '#79740e', brightYellow: '#b57614',
      brightBlue: '#076678', brightMagenta: '#8f3f71', brightCyan: '#427b58', brightWhite: '#3c3836',
    },
    credit: { label: 'Gruvbox by morhetz', url: 'https://github.com/morhetz/gruvbox' },
  }],
  ['catppuccin-mocha', {
    colors: {
      foreground: '#cdd6f4', background: '#1e1e2e', cursor: '#f5e0dc',
      black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af',
      blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#a6adc8',
      brightBlack: '#585b70', brightRed: '#f37799', brightGreen: '#89d88b', brightYellow: '#ebd391',
      brightBlue: '#74a8fc', brightMagenta: '#f2aede', brightCyan: '#6bd7ca', brightWhite: '#bac2de',
    },
    credit: { label: 'Catppuccin', url: 'https://catppuccin.com' },
  }],
  ['catppuccin-latte', {
    colors: {
      foreground: '#4c4f69', background: '#eff1f5', cursor: '#dc8a78',
      black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d',
      blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
      brightBlack: '#6c6f85', brightRed: '#de293e', brightGreen: '#49af3d', brightYellow: '#eea02d',
      brightBlue: '#456eff', brightMagenta: '#fe85d8', brightCyan: '#2d9fa8', brightWhite: '#bcc0cc',
    },
    credit: { label: 'Catppuccin', url: 'https://catppuccin.com' },
  }],
  ['tokyo-night', {
    colors: {
      foreground: '#a9b1d6', background: '#1a1b26', cursor: '#c0caf5',
      black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68',
      blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
      brightBlack: '#414868', brightRed: '#f7768e', brightGreen: '#9ece6a', brightYellow: '#e0af68',
      brightBlue: '#7aa2f7', brightMagenta: '#bb9af7', brightCyan: '#7dcfff', brightWhite: '#c0caf5',
    },
    credit: { label: 'Tokyo Night by Enkia', url: 'https://github.com/enkia/tokyo-night-vscode-theme' },
  }],
  ['one-dark', {
    colors: {
      foreground: '#abb2bf', background: '#21252b', cursor: '#abb2bf',
      black: '#21252b', red: '#e06c75', green: '#98c379', yellow: '#e5c07b',
      blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
      brightBlack: '#767676', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b',
      brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#abb2bf',
    },
    credit: { label: 'One Dark (Atom)', url: 'https://github.com/atom/one-dark-syntax' },
  }],
  ['tango-dark', {
    colors: {
      foreground: '#ffffff', background: '#000000', cursor: '#ffffff',
      black: '#000000', red: '#cc0000', green: '#4e9a06', yellow: '#c4a000',
      blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#d3d7cf',
      brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#8ae234', brightYellow: '#fce94f',
      brightBlue: '#729fcf', brightMagenta: '#ad7fa8', brightCyan: '#34e2e2', brightWhite: '#eeeeec',
    },
    credit: { label: 'Tango (freedesktop.org)', url: 'https://freedesktop.org' },
  }],
  ['tango-light', {
    colors: {
      foreground: '#000000', background: '#ffffff', cursor: '#000000',
      black: '#000000', red: '#cc0000', green: '#4e9a06', yellow: '#c4a000',
      blue: '#3465a4', magenta: '#75507b', cyan: '#06989a', white: '#b9bdb5',
      brightBlack: '#555753', brightRed: '#ef2929', brightGreen: '#7dd527', brightYellow: '#d6c329',
      brightBlue: '#729fcf', brightMagenta: '#ad7fa8', brightCyan: '#27d5d5', brightWhite: '#eeeeec',
    },
    credit: { label: 'Tango (freedesktop.org)', url: 'https://freedesktop.org' },
  }],
];

/** Map of built-in theme name → colors + credit. */
export const BUILTIN_THEMES: ReadonlyMap<string, BuiltinThemeEntry> = new Map(BUILTIN_ENTRIES);

/** All names that are reserved (built-ins + the 'default' alias). */
export const BUILTIN_THEME_NAMES: ReadonlySet<string> = new Set([
  'default',
  ...BUILTIN_ENTRIES.map(([name]) => name),
]);

/** Ordered list of built-in theme names for display. */
export const BUILTIN_THEME_LIST: readonly string[] = [
  'default',
  ...BUILTIN_ENTRIES.map(([name]) => name),
];

export const DEFAULT_THEME_NAME = 'default';

// ── ThemeStore ──────────────────────────────────────────────────────────────

export class ThemeStore {
  private themesDir: string;

  constructor(dataFolder: string) {
    this.themesDir = join(dataFolder, 'themes');
  }

  ensureDefaults(): void {
    mkdirSync(this.themesDir, { recursive: true });
    // Migration: remove old default.json (built-ins are now in code)
    const defaultPath = join(this.themesDir, 'default.json');
    if (existsSync(defaultPath)) {
      try { unlinkSync(defaultPath); } catch { /* ignore */ }
    }
  }

  list(): string[] {
    const builtinNames = [...BUILTIN_THEME_LIST];
    try {
      const files = readdirSync(this.themesDir);
      const userNames = files
        .filter(f => f.endsWith('.json'))
        .map(f => f.slice(0, -5))
        .filter(name => THEME_NAME_RE.test(name) && !BUILTIN_THEME_NAMES.has(name));
      userNames.sort();
      return [...builtinNames, ...userNames];
    } catch {
      return builtinNames;
    }
  }

  get(name: string): unknown {
    if (!THEME_NAME_RE.test(name) && name !== 'default') return undefined;

    // 'default' resolves to default-dark on the server (no OS context)
    if (name === 'default') {
      const entry = BUILTIN_THEMES.get('default-dark');
      return entry ? { name: 'default', colors: entry.colors } : undefined;
    }

    // Check built-in themes
    const builtin = BUILTIN_THEMES.get(name);
    if (builtin) return { name, colors: builtin.colors };

    // Fall through to disk
    if (!THEME_NAME_RE.test(name)) return undefined;
    try {
      const raw = readFileSync(join(this.themesDir, `${name}.json`), 'utf-8');
      return JSON.parse(raw) as unknown;
    } catch {
      return undefined;
    }
  }

  save(name: string, data: unknown): void {
    if (BUILTIN_THEME_NAMES.has(name)) throw new Error('Cannot overwrite a built-in theme');
    if (!THEME_NAME_RE.test(name)) throw new Error('Invalid theme name');
    writeFileSync(
      join(this.themesDir, `${name}.json`),
      JSON.stringify(data, null, 2),
    );
  }

  delete(name: string): boolean {
    if (BUILTIN_THEME_NAMES.has(name)) return false;
    if (!THEME_NAME_RE.test(name)) return false;
    try {
      unlinkSync(join(this.themesDir, `${name}.json`));
      return true;
    } catch {
      return false;
    }
  }
}
