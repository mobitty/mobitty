// OSC notification parsers for terminal notification protocols.
// See docs/design-terminal-env.md for protocol details.

import type { Terminal } from '@xterm/headless';

interface NotificationPayload {
  title: string;
  body: string;
}

/**
 * OSC 9 — iTerm2 / ConEmu notification.
 * Plain format: `\e]9;message\a`
 * ConEmu sub-command 2: `\e]9;2;message\a`
 * Claude Code emits the ConEmu format.
 */
export function parseOsc9(data: string): NotificationPayload {
  // ConEmu sub-command: first token is a digit, rest after ';' is message
  const semi = data.indexOf(';');
  if (semi !== -1 && /^\d+$/.test(data.substring(0, semi))) {
    return { title: 'Notification', body: data.substring(semi + 1) };
  }
  // Plain iTerm2 format: entire data is the message
  return { title: 'Notification', body: data };
}

/**
 * OSC 99 — Kitty notification protocol.
 * Format: `\e]99;params;body\e\\`
 * Params are colon-separated key=value pairs before the first `;`.
 * Keys: d (done), p (title/payload type), i (identifier).
 * `p=title` means the body is the notification title (not body text).
 * A notification without `p=title` treats body as body text.
 */
export function parseOsc99(data: string): NotificationPayload | null {
  const semiIdx = data.indexOf(';');
  if (semiIdx === -1) return null;
  const paramsPart = data.substring(0, semiIdx);
  const body = data.substring(semiIdx + 1);
  let title = 'Notification';
  for (const param of paramsPart.split(':')) {
    if (param === 'p=title') {
      // When p=title, the body IS the title text
      return { title: body || 'Notification', body: '' };
    }
  }
  return { title, body };
}

/**
 * OSC 777 — rxvt-unicode / Ghostty notification.
 * Format: `\e]777;notify;title;body\a`
 */
export function parseOsc777(data: string): NotificationPayload | null {
  // Expected: "notify;title;body"
  if (!data.startsWith('notify;')) return null;
  const rest = data.substring(7); // after "notify;"
  const semi = rest.indexOf(';');
  if (semi === -1) {
    return { title: rest || 'Notification', body: '' };
  }
  return { title: rest.substring(0, semi) || 'Notification', body: rest.substring(semi + 1) };
}

type NotificationCallback = (title: string, body: string) => void;

/**
 * Register OSC 9, 99, and 777 handlers on a headless terminal.
 * Handlers are registered unconditionally — the notification mode only controls
 * what TERM_PROGRAM is set (which determines what the program emits).
 */
export function registerNotificationHandlers(
  terminal: Terminal,
  onNotification: NotificationCallback,
): void {
  // OSC 9 — iTerm2 / ConEmu
  terminal.parser.registerOscHandler(9, (data: string) => {
    // Skip progress bar sub-commands (OSC 9;4;...)
    if (data.startsWith('4;')) return false;
    const payload = parseOsc9(data);
    onNotification(payload.title, payload.body);
    return true;
  });

  // OSC 99 — Kitty
  terminal.parser.registerOscHandler(99, (data: string) => {
    const payload = parseOsc99(data);
    if (payload) onNotification(payload.title, payload.body);
    return true;
  });

  // OSC 777 — Ghostty / rxvt-unicode
  terminal.parser.registerOscHandler(777, (data: string) => {
    const payload = parseOsc777(data);
    if (payload) onNotification(payload.title, payload.body);
    return false; // let other 777 handlers run (multi-purpose OSC)
  });
}
