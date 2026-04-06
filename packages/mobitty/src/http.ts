import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { resolve, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';
import { type ProfileStore, DEFAULT_PROFILE_NAMES } from './profiles.ts';
import { type ThemeStore, BUILTIN_THEME_NAMES } from './themes.ts';
import type { ShellStore } from './shells.ts';
import type { SessionRegistry } from './sessions.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

const JSON_HEADERS = { 'Content-Type': 'application/json; charset=utf-8' };
const MAX_BODY_BYTES = 65536;
const MAX_EDITOR_BODY_BYTES = 5 * 1024 * 1024; // 5 MB for editor content

const CLIENT_DIR = resolve(__dirname, '..', 'client');

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

interface AssetCache {
  raw: Buffer;
  br: Buffer;
  gzip: Buffer;
  etag: string;
  contentType: string;
  immutable: boolean;
}

const assetCacheMap = new Map<string, AssetCache | false>();

function loadAsset(urlPath: string): AssetCache | undefined {
  const cached = assetCacheMap.get(urlPath);
  if (cached === false) return undefined;
  if (cached !== undefined) return cached;

  const filePath = resolve(CLIENT_DIR, '.' + urlPath);
  if (!filePath.startsWith(CLIENT_DIR + '/')) {
    assetCacheMap.set(urlPath, false);
    return undefined;
  }

  try {
    const raw = readFileSync(filePath);
    const ext = extname(filePath);
    const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
    const etag = '"' + createHash('sha256').update(raw).digest('hex').slice(0, 16) + '"';
    const immutable = urlPath.startsWith('/assets/');
    const br = brotliCompressSync(raw, {
      params: { [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY },
    });
    const gzip = gzipSync(raw, { level: 9 });
    const asset: AssetCache = { raw, br, gzip, etag, contentType, immutable };
    assetCacheMap.set(urlPath, asset);
    return asset;
  } catch {
    assetCacheMap.set(urlPath, false);
    return undefined;
  }
}

function serveAsset(req: IncomingMessage, res: ServerResponse, asset: AssetCache): void {
  if (req.headers['if-none-match'] === asset.etag) {
    res.writeHead(304);
    res.end();
    return;
  }
  const accept = req.headers['accept-encoding'] ?? '';
  const headers: Record<string, string> = {
    'Content-Type': asset.contentType,
    'ETag': asset.etag,
    'Cache-Control': asset.immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    'Vary': 'Accept-Encoding',
  };
  if (accept.includes('br')) {
    headers['Content-Encoding'] = 'br';
    res.writeHead(200, headers);
    res.end(asset.br);
  } else if (accept.includes('gzip')) {
    headers['Content-Encoding'] = 'gzip';
    res.writeHead(200, headers);
    res.end(asset.gzip);
  } else {
    res.writeHead(200, headers);
    res.end(asset.raw);
  }
}

function readBody(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.destroy();
        reject(new Error('Body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function jsonResponse(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(data));
}

function parseProfileName(pathname: string): string | undefined {
  const match = /^\/api\/profiles\/([a-zA-Z0-9_-]{1,64})$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

function parseThemeName(pathname: string): string | undefined {
  const match = /^\/api\/themes\/([a-zA-Z0-9_-]{1,64})$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

function parseShellName(pathname: string): string | undefined {
  const match = /^\/api\/shells\/([a-zA-Z0-9_-]{1,64})$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

function parseSessionId(pathname: string): string | undefined {
  const match = /^\/api\/sessions\/([a-f0-9-]{36})$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

function parseSessionNamePath(pathname: string): string | undefined {
  const match = /^\/api\/sessions\/([a-f0-9-]{36})\/name$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

function parseSessionOrderPath(pathname: string): string | undefined {
  const match = /^\/api\/sessions\/([a-f0-9-]{36})\/order$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

function parseSessionEditorPath(pathname: string): string | undefined {
  const match = /^\/api\/sessions\/([a-f0-9-]{36})\/editor$/.exec(pathname);
  if (match) return match[1];
  return undefined;
}

export function handleHttpRequest(req: IncomingMessage, res: ServerResponse, profileStore: ProfileStore, themeStore: ThemeStore, shellStore: ShellStore, registry: SessionRegistry): void {
  const url = req.url ?? '/';
  const method = req.method ?? 'GET';
  const pathname = new URL(url, 'http://localhost').pathname;

  if (url === '/token') {
    jsonResponse(res, 200, { token: '' });
    return;
  }

  if (pathname === '/api/profiles' && method === 'GET') {
    jsonResponse(res, 200, { profiles: profileStore.list() });
    return;
  }

  const profileName = parseProfileName(pathname);
  if (profileName !== undefined && pathname === `/api/profiles/${profileName}`) {
    if (method === 'GET') {
      const profile = profileStore.get(profileName);
      if (profile === undefined) {
        jsonResponse(res, 404, { error: 'Profile not found' });
      } else {
        jsonResponse(res, 200, profile);
      }
      return;
    }

    if (method === 'PUT') {
      if (DEFAULT_PROFILE_NAMES.has(profileName)) {
        jsonResponse(res, 400, { error: 'Cannot modify a default profile' });
        return;
      }
      readBody(req).then(body => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          jsonResponse(res, 400, { error: 'Invalid JSON' });
          return;
        }
        profileStore.save(profileName, parsed);
        jsonResponse(res, 200, parsed);
      }).catch(() => {
        jsonResponse(res, 400, { error: 'Failed to read request body' });
      });
      return;
    }

    if (method === 'DELETE') {
      if (DEFAULT_PROFILE_NAMES.has(profileName)) {
        jsonResponse(res, 400, { error: 'Cannot delete a default profile' });
        return;
      }
      const deleted = profileStore.delete(profileName);
      if (deleted) {
        jsonResponse(res, 200, { deleted: profileName });
      } else {
        jsonResponse(res, 404, { error: 'Profile not found' });
      }
      return;
    }
  }

  // --- Theme routes ---

  if (pathname === '/api/themes' && method === 'GET') {
    jsonResponse(res, 200, { themes: themeStore.list() });
    return;
  }

  const themeName = parseThemeName(pathname);
  if (themeName !== undefined && pathname === `/api/themes/${themeName}`) {
    if (method === 'GET') {
      const theme = themeStore.get(themeName);
      if (theme === undefined) {
        jsonResponse(res, 404, { error: 'Theme not found' });
      } else {
        jsonResponse(res, 200, theme);
      }
      return;
    }

    if (method === 'PUT') {
      if (BUILTIN_THEME_NAMES.has(themeName)) {
        jsonResponse(res, 400, { error: 'Cannot modify a built-in theme' });
        return;
      }
      readBody(req).then(body => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          jsonResponse(res, 400, { error: 'Invalid JSON' });
          return;
        }
        themeStore.save(themeName, parsed);
        jsonResponse(res, 200, parsed);
      }).catch(() => {
        jsonResponse(res, 400, { error: 'Failed to read request body' });
      });
      return;
    }

    if (method === 'DELETE') {
      if (BUILTIN_THEME_NAMES.has(themeName)) {
        jsonResponse(res, 400, { error: 'Cannot delete a built-in theme' });
        return;
      }
      const deleted = themeStore.delete(themeName);
      if (deleted) {
        jsonResponse(res, 200, { deleted: themeName });
      } else {
        jsonResponse(res, 404, { error: 'Theme not found' });
      }
      return;
    }
  }

  // --- Shell routes ---

  if (pathname === '/api/shells' && method === 'GET') {
    jsonResponse(res, 200, { shells: shellStore.list() });
    return;
  }

  if (pathname === '/api/shells/rediscover' && method === 'POST') {
    shellStore.rediscover();
    jsonResponse(res, 200, { shells: shellStore.list() });
    return;
  }

  const shellName = parseShellName(pathname);
  if (shellName !== undefined && pathname === `/api/shells/${shellName}`) {
    if (method === 'GET') {
      const shell = shellStore.get(shellName);
      if (shell === undefined) {
        jsonResponse(res, 404, { error: 'Shell not found' });
      } else {
        jsonResponse(res, 200, shell);
      }
      return;
    }

    if (method === 'PUT') {
      readBody(req).then(body => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          jsonResponse(res, 400, { error: 'Invalid JSON' });
          return;
        }
        shellStore.save(shellName, parsed);
        jsonResponse(res, 200, parsed);
      }).catch(() => {
        jsonResponse(res, 400, { error: 'Failed to read request body' });
      });
      return;
    }

    if (method === 'DELETE') {
      const deleted = shellStore.delete(shellName);
      if (deleted) {
        jsonResponse(res, 200, { deleted: shellName });
      } else {
        jsonResponse(res, 404, { error: 'Shell not found' });
      }
      return;
    }
  }

  // --- Session routes ---

  if (pathname === '/api/sessions' && method === 'GET') {
    jsonResponse(res, 200, { sessions: registry.listSessions() });
    return;
  }

  if (pathname === '/api/sessions' && method === 'POST') {
    // No config to pass — sessions are created via WS handshake primarily,
    // but this endpoint allows creating one in advance (uses default config)
    jsonResponse(res, 501, { error: 'Create sessions via WebSocket handshake' });
    return;
  }

  const sessionNamePath = parseSessionNamePath(pathname);
  if (sessionNamePath !== undefined && method === 'PUT') {
    readBody(req).then(body => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        jsonResponse(res, 400, { error: 'Invalid JSON' });
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        jsonResponse(res, 400, { error: 'Invalid body' });
        return;
      }
      const name = (parsed as Record<string, unknown>)['name'];
      if (typeof name !== 'string') {
        jsonResponse(res, 400, { error: 'Missing name field' });
        return;
      }
      const ok = registry.renameSession(sessionNamePath, name);
      if (ok) {
        jsonResponse(res, 200, { sessionId: sessionNamePath, name });
      } else {
        jsonResponse(res, 404, { error: 'Session not found or invalid name' });
      }
    }).catch(() => {
      jsonResponse(res, 400, { error: 'Failed to read request body' });
    });
    return;
  }

  const sessionOrderPath = parseSessionOrderPath(pathname);
  if (sessionOrderPath !== undefined && method === 'PUT') {
    readBody(req).then(body => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        jsonResponse(res, 400, { error: 'Invalid JSON' });
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        jsonResponse(res, 400, { error: 'Invalid body' });
        return;
      }
      const index = (parsed as Record<string, unknown>)['index'];
      if (typeof index !== 'number' || !Number.isInteger(index) || index < 0) {
        jsonResponse(res, 400, { error: 'Missing or invalid index field' });
        return;
      }
      const ok = registry.reorderSession(sessionOrderPath, index);
      if (ok) {
        jsonResponse(res, 200, { sessionId: sessionOrderPath, index });
      } else {
        jsonResponse(res, 404, { error: 'Session not found' });
      }
    }).catch(() => {
      jsonResponse(res, 400, { error: 'Failed to read request body' });
    });
    return;
  }

  const sessionEditorPath = parseSessionEditorPath(pathname);
  if (sessionEditorPath !== undefined && method === 'POST') {
    readBody(req, MAX_EDITOR_BODY_BYTES).then(async body => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        jsonResponse(res, 400, { error: 'Invalid JSON' });
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) {
        jsonResponse(res, 400, { error: 'Invalid body' });
        return;
      }
      const r = parsed as Record<string, unknown>;
      if (typeof r['filePath'] !== 'string' || typeof r['content'] !== 'string') {
        jsonResponse(res, 400, { error: 'Missing filePath or content' });
        return;
      }
      const filePath = r['filePath'];
      const content = r['content'];

      try {
        const result = await registry.requestEdit(
          sessionEditorPath,
          filePath,
          content,
          (cleanup) => { req.on('close', cleanup); },
        );
        jsonResponse(res, 200, result);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === 'Session not found') {
          jsonResponse(res, 404, { error: msg });
        } else if (msg === 'Edit already in progress') {
          jsonResponse(res, 409, { error: msg });
        } else if (msg === 'No client connected') {
          jsonResponse(res, 503, { error: msg });
        } else {
          jsonResponse(res, 500, { error: msg });
        }
      }
    }).catch(() => {
      jsonResponse(res, 400, { error: 'Failed to read request body' });
    });
    return;
  }

  const sessionIdParam = parseSessionId(pathname);
  if (sessionIdParam !== undefined) {
    if (method === 'GET') {
      const session = registry.getSession(sessionIdParam);
      if (session) {
        jsonResponse(res, 200, session.info);
      } else {
        jsonResponse(res, 404, { error: 'Session not found' });
      }
      return;
    }

    if (method === 'DELETE') {
      const ok = registry.deleteSession(sessionIdParam);
      if (ok) {
        jsonResponse(res, 200, { deleted: sessionIdParam });
      } else {
        jsonResponse(res, 404, { error: 'Session not found' });
      }
      return;
    }
  }

  const assetPath = (url === '/' || url.startsWith('/?')) ? '/index.html' : pathname;
  const asset = loadAsset(assetPath);
  if (asset !== undefined) {
    serveAsset(req, res, asset);
    return;
  }

  if (assetPath === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<html><body><h1>Frontend not built. Run: pnpm run build</h1></body></html>');
    return;
  }

  res.writeHead(404);
  res.end('Not Found');
}
