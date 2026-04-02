// OSC 10/11/12 color query handlers.
// When programs (e.g. nvim) query the terminal's foreground/background/cursor
// color, the headless terminal cannot respond on its own. These handlers
// intercept the query and write the response directly back to the PTY.

import type { Terminal, IDisposable } from '@xterm/headless';

export interface OscColorConfig {
  foreground: string;   // hex '#rrggbb'
  background: string;   // hex '#rrggbb'
  cursor: string;       // hex '#rrggbb'
  writeToPty: (response: string) => void;
}

export interface OscColorQueryTracker {
  updateColors(fg: string, bg: string, cursor: string): void;
  dispose(): void;
}

/** Convert '#rrggbb' to X11 color spec 'rgb:rr/gg/bb'. */
export function hexToXColorSpec(hex: string): string {
  const r = hex.slice(1, 3).toLowerCase();
  const g = hex.slice(3, 5).toLowerCase();
  const b = hex.slice(5, 7).toLowerCase();
  return `rgb:${r}/${g}/${b}`;
}

/**
 * Register OSC 10 (foreground), 11 (background), 12 (cursor) query handlers
 * on a headless terminal. When the PTY application sends `\e]11;?\a`, the
 * handler responds with the current theme color via writeToPty.
 *
 * Non-query data (color SET commands) passes through to the built-in handler.
 */
export function registerColorQueryHandlers(
  terminal: Terminal,
  config: OscColorConfig,
): OscColorQueryTracker {
  const disposables: IDisposable[] = [];

  function makeHandler(oscCode: number, getColor: () => string) {
    return (data: string): boolean => {
      if (data === '?') {
        const rgb = hexToXColorSpec(getColor());
        config.writeToPty(`\x1b]${oscCode};${rgb}\x07`);
        return true;
      }
      return false;
    };
  }

  disposables.push(
    terminal.parser.registerOscHandler(10, makeHandler(10, () => config.foreground)),
    terminal.parser.registerOscHandler(11, makeHandler(11, () => config.background)),
    terminal.parser.registerOscHandler(12, makeHandler(12, () => config.cursor)),
  );

  return {
    updateColors(fg: string, bg: string, cursor: string) {
      config.foreground = fg;
      config.background = bg;
      config.cursor = cursor;
    },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
