import type { Terminal } from '@xterm/headless';
import type { IDisposable } from '@xterm/headless';

export interface CursorVisibilityTracker {
  readonly cursorHidden: boolean;
  dispose(): void;
}

export function trackCursorVisibility(
  terminal: Terminal,
  onChange?: () => void,
): CursorVisibilityTracker {
  let hidden = false;
  const disposables: IDisposable[] = [];

  function setHidden(value: boolean): void {
    if (hidden !== value) {
      hidden = value;
      onChange?.();
    }
  }

  // DECSET: CSI ? <n> h — mode 25 shows cursor, mode 1049 enters alt screen (cursor visible)
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
      for (const p of params) {
        if (p === 25 || p === 1049) {
          setHidden(false);
          break;
        }
      }
      return false;
    }),
  );

  // DECRST: CSI ? <n> l — mode 25 hides cursor, mode 1049 leaves alt screen (cursor visible)
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
      for (const p of params) {
        if (p === 25) { setHidden(true); break; }
        if (p === 1049) { setHidden(false); break; }
      }
      return false;
    }),
  );

  // RIS: ESC c — full terminal reset, cursor becomes visible
  disposables.push(
    terminal.parser.registerEscHandler({ final: 'c' }, () => {
      setHidden(false);
      return false;
    }),
  );

  // DECSTR: CSI ! p — soft terminal reset, cursor becomes visible
  disposables.push(
    terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      setHidden(false);
      return false;
    }),
  );

  return {
    get cursorHidden() { return hidden; },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
