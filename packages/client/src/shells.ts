export interface ShellInfo {
  name: string;
  argv: string[];
  env?: Record<string, string>;
  source: 'saved' | 'discovered';
}

function buildApiUrl(path: string): string {
  const base = window.location.pathname.replace(/[/]+$/, '');
  return `${window.location.protocol}//${window.location.host}${base}${path}`;
}

export async function fetchShells(): Promise<ShellInfo[]> {
  const resp = await fetch(buildApiUrl('/api/shells'));
  if (!resp.ok) return [];
  const data = await resp.json() as Record<string, unknown>;
  if (Array.isArray(data['shells'])) {
    return data['shells'] as ShellInfo[];
  }
  return [];
}

export async function saveShell(name: string, data: { name: string; argv: string[]; env?: Record<string, string> }): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/shells/${encodeURIComponent(name)}`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return resp.ok;
}

export async function deleteShell(name: string): Promise<boolean> {
  const resp = await fetch(buildApiUrl(`/api/shells/${encodeURIComponent(name)}`), {
    method: 'DELETE',
  });
  return resp.ok;
}

export async function rediscoverShells(): Promise<ShellInfo[]> {
  const resp = await fetch(buildApiUrl('/api/shells/rediscover'), {
    method: 'POST',
  });
  if (!resp.ok) return [];
  const data = await resp.json() as Record<string, unknown>;
  if (Array.isArray(data['shells'])) {
    return data['shells'] as ShellInfo[];
  }
  return [];
}
