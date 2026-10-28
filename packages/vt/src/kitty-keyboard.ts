import type { Terminal, IDisposable } from '@xterm/headless';

/**
 * Kitty keyboard protocol state (`CSI = | ? | > | < u`) for one session.
 *
 * Under the state-sync model the client never sees the app's raw VT, so an
 * app's `CSI > 5 u` would die in the headless parser and the client's xterm
 * would keep encoding Ctrl+Enter as `\r`. This passive tracker owns the
 * protocol state server-side; `diff.ts` replays it to the client as a single
 * `CSI = N ; 1 u` assignment. The headless terminal keeps
 * `vtExtensions.kittyKeyboard` off — this tracker is the single source of
 * truth and needs no xterm internals.
 *
 * Semantics follow the kitty spec and xterm.js 6.1's `InputHandler`:
 * - one `{ flags, stack }` per screen (normal, alternate), picked from the
 *   active buffer when each sequence is parsed; switching screens neither
 *   resets nor copies state;
 * - push evicts the oldest entry past 16; a pop that empties the stack leaves
 *   flags 0;
 * - RIS and DECSTR reset both screens.
 *
 * See docs/todo-bug-ctrl-enter-alt-buffer.md.
 */
export interface KittyKeyboardTracker {
  /** Effective flags of the active screen. */
  readonly flags: number;
  dispose(): void;
}

interface ScreenState {
  flags: number;
  stack: number[];
}

/** Kitty's DoS limit on the per-screen flags stack. */
const MAX_STACK = 16;

function firstParam(params: (number | number[])[], fallback: number): number {
  const p = params[0];
  // Sub-parameter arrays (`1:2`) are not meaningful here; use the leading value.
  const v = Array.isArray(p) ? p[0] : p;
  return typeof v === 'number' && v > 0 ? v : fallback;
}

export function trackKittyKeyboard(
  terminal: Terminal,
  opts: { reply: (data: string) => void; onChange?: (flags: number) => void },
): KittyKeyboardTracker {
  const normal: ScreenState = { flags: 0, stack: [] };
  const alternate: ScreenState = { flags: 0, stack: [] };
  const disposables: IDisposable[] = [];

  const active = (): ScreenState =>
    terminal.buffer.active.type === 'alternate' ? alternate : normal;

  /** Run `mutate` on the active screen and fire onChange if its flags moved. */
  function update(mutate: (s: ScreenState) => void): void {
    const s = active();
    const before = s.flags;
    mutate(s);
    if (s.flags !== before) opts.onChange?.(s.flags);
  }

  function resetAll(): void {
    const before = active().flags;
    for (const s of [normal, alternate]) { s.flags = 0; s.stack.length = 0; }
    if (before !== 0) opts.onChange?.(0);
  }

  // CSI > Ps u — push the current flags, then set Ps.
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '>', final: 'u' }, params => {
      const flags = firstParam(params, 0);
      update(s => {
        if (s.stack.length >= MAX_STACK) s.stack.shift();
        s.stack.push(s.flags);
        s.flags = flags;
      });
      return false;
    }),
  );

  // CSI < Ps u — pop max(1, Ps) entries.
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '<', final: 'u' }, params => {
      const count = firstParam(params, 1);
      update(s => {
        for (let i = 0; i < count && s.stack.length > 0; i++) s.flags = s.stack.pop()!;
        if (s.stack.length === 0) s.flags = 0;
      });
      return false;
    }),
  );

  // CSI = Ps ; Pm u — Pm 1 (default) assign, 2 OR, 3 AND-NOT.
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '=', final: 'u' }, params => {
      const flags = firstParam(params, 0);
      const p1 = params.length > 1 ? params[1] : undefined;
      const mode = (Array.isArray(p1) ? p1[0] : p1) || 1;
      update(s => {
        switch (mode) {
          case 1: s.flags = flags; break;
          case 2: s.flags |= flags; break;
          case 3: s.flags &= ~flags; break;
        }
      });
      return false;
    }),
  );

  // CSI ? u — query. Answer with the active screen's flags and claim the
  // sequence (return true) so the built-in handler can never add a second
  // reply, even if `headless.onData` is wired up later.
  disposables.push(
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'u' }, () => {
      opts.reply(`\x1b[?${active().flags}u`);
      return true;
    }),
  );

  // RIS: ESC c — full reset clears both screens.
  disposables.push(
    terminal.parser.registerEscHandler({ final: 'c' }, () => {
      resetAll();
      return false;
    }),
  );

  // DECSTR: CSI ! p — xterm.js resets kitty state on soft reset too.
  disposables.push(
    terminal.parser.registerCsiHandler({ intermediates: '!', final: 'p' }, () => {
      resetAll();
      return false;
    }),
  );

  return {
    get flags() { return active().flags; },
    dispose() {
      for (const d of disposables) d.dispose();
      disposables.length = 0;
    },
  };
}
