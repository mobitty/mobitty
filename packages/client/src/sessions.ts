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
