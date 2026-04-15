import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { resolveAssetPath, handleHttpRequest } from './http.ts';
import type { PathFns } from './http.ts';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ProfileStore } from './profiles.ts';
import type { ThemeStore } from './themes.ts';
import type { ShellStore } from './shells.ts';
import type { SessionRegistry } from './sessions.ts';

const posixFns: PathFns = {
  resolve: path.posix.resolve,
  relative: path.posix.relative,
  isAbsolute: path.posix.isAbsolute,
};

const win32Fns: PathFns = {
  resolve: path.win32.resolve,
  relative: path.win32.relative,
  isAbsolute: path.win32.isAbsolute,
};

describe('resolveAssetPath (posix)', () => {
  const clientDir = '/app/client';

  it('resolves /index.html', () => {
    assert.equal(resolveAssetPath(clientDir, '/index.html', posixFns), '/app/client/index.html');
  });

  it('resolves nested asset path', () => {
    assert.equal(
      resolveAssetPath(clientDir, '/assets/index-abc123.js', posixFns),
      '/app/client/assets/index-abc123.js',
    );
  });

  it('blocks directory traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/../../../etc/passwd', posixFns), undefined);
  });

  it('blocks single-level traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/../secret', posixFns), undefined);
  });
});

describe('resolveAssetPath (win32)', () => {
  const clientDir = 'C:\\Users\\app\\client';

  it('resolves /index.html', () => {
    assert.equal(
      resolveAssetPath(clientDir, '/index.html', win32Fns),
      'C:\\Users\\app\\client\\index.html',
    );
  });

  it('resolves nested asset path', () => {
    assert.equal(
      resolveAssetPath(clientDir, '/assets/index-abc123.js', win32Fns),
      'C:\\Users\\app\\client\\assets\\index-abc123.js',
    );
  });

  it('blocks directory traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/../../../etc/passwd', win32Fns), undefined);
  });

  it('blocks cross-drive traversal', () => {
    assert.equal(resolveAssetPath(clientDir, '/D:/other', win32Fns), undefined);
  });
});

// --- Security headers ---

function mockReq(url: string, method = 'GET'): IncomingMessage {
  const req = new EventEmitter() as IncomingMessage;
  req.url = url;
  req.method = method;
  req.headers = {};
  return req;
}

function mockRes(): ServerResponse & { _headers: Map<string, string | string[]>; _status: number } {
  const headers = new Map<string, string | string[]>();
  const res = {
    _headers: headers,
    _status: 0,
    setHeader(name: string, value: string) { headers.set(name.toLowerCase(), value); },
    getHeader(name: string) { return headers.get(name.toLowerCase()); },
    writeHead(status: number) { res._status = status; },
    end() {},
    headersSent: false,
  } as unknown as ServerResponse & { _headers: Map<string, string | string[]>; _status: number };
  return res;
}

const stubProfileStore = { list: () => [], get: () => undefined } as unknown as ProfileStore;
const stubThemeStore = { list: () => [], get: () => undefined } as unknown as ThemeStore;
const stubShellStore = { list: () => [], get: () => undefined } as unknown as ShellStore;
const stubRegistry = { listSessions: () => [] } as unknown as SessionRegistry;

describe('security headers', () => {
  it('sets CSP on JSON API responses', () => {
    const req = mockReq('/api/profiles');
    const res = mockRes();
    handleHttpRequest(req, res, stubProfileStore, stubThemeStore, stubShellStore, stubRegistry);
    assert.equal(res._headers.get('content-security-policy'), "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'");
  });

  it('sets X-Frame-Options DENY', () => {
    const req = mockReq('/api/profiles');
    const res = mockRes();
    handleHttpRequest(req, res, stubProfileStore, stubThemeStore, stubShellStore, stubRegistry);
    assert.equal(res._headers.get('x-frame-options'), 'DENY');
  });

  it('sets X-Content-Type-Options nosniff', () => {
    const req = mockReq('/api/profiles');
    const res = mockRes();
    handleHttpRequest(req, res, stubProfileStore, stubThemeStore, stubShellStore, stubRegistry);
    assert.equal(res._headers.get('x-content-type-options'), 'nosniff');
  });

  it('sets security headers on 404 responses', () => {
    const req = mockReq('/nonexistent-path');
    const res = mockRes();
    handleHttpRequest(req, res, stubProfileStore, stubThemeStore, stubShellStore, stubRegistry);
    assert.equal(res._headers.get('content-security-policy'), "default-src 'self'; connect-src 'self' ws: wss:; style-src 'self'");
    assert.equal(res._headers.get('x-frame-options'), 'DENY');
    assert.equal(res._headers.get('x-content-type-options'), 'nosniff');
  });
});
