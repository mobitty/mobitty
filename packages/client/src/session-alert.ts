/**
 * The attached session's own alerts: a bell or an OSC 9/99/777 notification
 * from the session on screen.
 */

/** Handshake `capabilities`. A field left out means the browser's own
 *  behaviour (every view kind, downloads, image edits), so the browser lists
 *  only what differs: it wants its own session's alerts too. */
export interface HandshakeCapabilities {
  sessionAlerts: boolean;
}

export const BROWSER_CAPABILITIES: HandshakeCapabilities = { sessionAlerts: true };

/** Prefix of the tab title while the session on screen has an unseen alert. */
export const ALERT_TITLE_MARK = '• ';

export function markTitle(title: string, alerted: boolean): string {
  return alerted ? ALERT_TITLE_MARK + title : title;
}

/** Whether input the client sends to the session is the user typing, which
 *  clears the session's alert. Focus reports and mouse reports are not. */
export function isTypedInput(data: string): boolean {
  if (data === '\x1b[I' || data === '\x1b[O') return false;
  if (/^\x1b\[<\d+;\d+;\d+[Mm]$/.test(data)) return false; // SGR mouse
  if (data.length === 6 && data.startsWith('\x1b[M')) return false; // X10 mouse
  return true;
}
