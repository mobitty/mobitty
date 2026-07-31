import type { Terminal } from '@xterm/headless';
import type { IDisposable } from '@xterm/headless';
import type { MouseEncoding } from './diff.ts';

export interface MouseEncodingTracker {
  readonly encoding: MouseEncoding;
  dispose(): void;
}

// DEC private mode → mouse report encoding. xterm.js does not expose the active
// mouse encoding on its public `terminal.modes` (only `mouseTrackingMode`), so
// the diff/serialize layer can't read it the way it reads tracking mode. This
// side-channel tracker observes the encoding DECSET/DECRSTs directly and stores
// the derived encoding on the session, mirroring `cursor-visibility.ts`.
//   1005 → UTF-8, 1006 → SGR, 1015 → urxvt, 1016 → SGR-pixels
// See docs/done-bug-copilot-mouse-sgr-encoding-not-serialized.md.
const ENCODING_BY_MODE: Record<number, MouseEncoding> = {
  1005: 'utf8',
  1006: 'sgr',
  1015: 'urxvt',
  1016: 'sgr-pixels',
};

export function trackMouseEncoding(
  terminal: Terminal,
  onChange?: (encoding: MouseEncoding) => void,
): MouseEncodingTracker {
  let encoding: MouseEncoding = 'default';
  const disposables: IDisposable[] = [];

  function set(next: MouseEncoding): void {
    if (encoding !== next) {
      encoding = next;
      onChange?.(encoding);
    }
  }

  // DECSET: CSI ? <n> h — enabling an encoding mode makes it active.
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, params => {
      for (const p of params) {
        // CSI params can be sub-parameter arrays (e.g. `38:5:1`); DEC private
        // mode numbers are always plain numbers.
        if (typeof p !== 'number') continue;
        const enc = ENCODING_BY_MODE[p];
        if (enc) { set(enc); break; }
      }
      return false;
    }),
  );

  // DECRST: CSI ? <n> l — disabling the *active* encoding mode reverts to X10.
  // Resetting a mode that isn't the active one is a no-op (matches xterm.js:
  // a single activeEncoding, last-set-wins, reset returns to DEFAULT).
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'l' }, params => {
      for (const p of params) {
        if (typeof p !== 'number') continue;
        const enc = ENCODING_BY_MODE[p];
        if (enc && enc === encoding) { set('default'); break; }
      }
      return false;
    }),
  );

  // RIS: ESC c — full reset returns to the default X10 encoding.
  disposables.push(
    terminal.parser.registerEscHandler({ final: 'c' }, () => {
      set('default');
      return false;
    }),
  );

  // DECSTR: CSI ! p — soft reset also clears mouse encoding.
  disposables.push(
    terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      set('default');
      return false;
    }),
  );

  return {
    get encoding() { return encoding; },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
