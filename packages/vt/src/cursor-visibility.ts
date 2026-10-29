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

  // DECTCEM (`?25`) only, as xterm.js keeps it: `?25h` shows, `?25l` hides.
  // Alternate-screen switches (`?47`, `?1047`, `?1049`) leave visibility
  // alone, so an app that hides the cursor and then enters the alternate
  // screen keeps it hidden. Parser hooks run before xterm.js's own handler,
  // so onChange could not read `terminal.modes.showCursor` here: it would
  // still hold the old value.
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
      if (params.includes(25)) setHidden(false);
      return false;
    }),
  );

  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
      if (params.includes(25)) setHidden(true);
      return false;
    }),
  );

  // RIS (ESC c) is not handled: xterm.js's full reset leaves the cursor's
  // visibility as it was (its CoreService.reset() does not touch it), in
  // the headless and the browser build alike.

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
