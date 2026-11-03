export interface SessionInfo {
  sessionId: string;
  name: string;
  pid: number;
  alive: boolean;
  createdAt: string;
  command: string;
  shell: string;
  title: string;
  hasAlert: boolean;
  cwd: string;
}

const STORAGE_KEY = 'mobitty-session-id';

export function getLastSessionId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setLastSessionId(id: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // localStorage may be unavailable
  }
}

export function clearLastSessionId(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorage may be unavailable
  }
}

/** Query parameter that names the session a page load should attach to,
 *  e.g. `https://host/?session=<id>`. It takes precedence over the session
 *  remembered in localStorage, so a link opens that session in a new tab
 *  without disturbing the session other tabs are on. The server ignores it
 *  (the WebSocket URL carries the page's query string through unchanged). */
export const SESSION_URL_PARAM = 'session';

/** The session id named by a page's query string, or null when absent/empty. */
export function sessionIdFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get(SESSION_URL_PARAM);
  return id ? id : null;
}

/** `href` with the session parameter set to `sessionId` (or removed when
 *  null). Other query parameters and the hash are preserved. */
export function withSessionParam(href: string, sessionId: string | null): string {
  const url = new URL(href);
  if (sessionId) url.searchParams.set(SESSION_URL_PARAM, sessionId);
  else url.searchParams.delete(SESSION_URL_PARAM);
  return url.toString();
}

/** Absolute URL that opens `sessionId` directly when loaded. */
export function buildSessionUrl(sessionId: string): string {
  return withSessionParam(window.location.href, sessionId);
}

/** The session this page load should attach to: the one named in the URL,
 *  else the last one used in this browser. */
export function getInitialSessionId(): string | null {
  return sessionIdFromSearch(window.location.search) ?? getLastSessionId();
}

/** Keep the address bar naming the session this tab is attached to, so a
 *  reload returns to it rather than to whatever another tab used last. */
export function syncSessionUrl(sessionId: string | null): void {
  try {
    const next = withSessionParam(window.location.href, sessionId);
    if (next !== window.location.href) window.history.replaceState(window.history.state, '', next);
  } catch {
    // history may be unavailable
  }
}

function buildApiUrl(path: string): string {
  const base = window.location.pathname.replace(/[/]+$/, '');
  return `${window.location.protocol}//${window.location.host}${base}${path}`;
}

export async function fetchSessions(): Promise<SessionInfo[]> {
  const resp = await fetch(buildApiUrl('/api/sessions'));
  if (!resp.ok) return [];
  const data = await resp.json() as Record<string, unknown>;
  if (Array.isArray(data['sessions'])) {
    return data['sessions'] as SessionInfo[];
  }
  return [];
}

export async function renameSession(id: string, name: string): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/sessions/${encodeURIComponent(id)}/name`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return resp.ok;
}

export async function reorderSession(id: string, index: number): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/sessions/${encodeURIComponent(id)}/order`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index }),
  });
  return resp.ok;
}

export async function deleteSession(id: string): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/sessions/${encodeURIComponent(id)}`), {
    method: 'DELETE',
  });
  return resp.ok;
}
