// Client capabilities declared in the handshake: views a client can't show
// stay queued, downloads and image edits are refused. See
// docs/todo-design-file-viewer.md and docs/done-design-remote-editor.md.

import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { SessionRegistry, IMAGE_EDIT_UNSUPPORTED, type AttachedClient, type ViewRequest } from './sessions.ts';
import { handleHttpRequest, DOWNLOAD_UNSUPPORTED } from './http.ts';
import {
  DEFAULT_CAPABILITIES, DOWNLOAD_START, VIEWER_NOTICE, VIEWER_OPEN, VIEWER_SYNC,
  isHandshakeMessage, resolveCapabilities,
} from './types.ts';
import type { ClientCapabilities } from './types.ts';
import type { ProfileStore } from './profiles.ts';
import type { ThemeStore } from './themes.ts';
import type { ShellStore } from './shells.ts';

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false };
const testShellArgv = process.platform === 'win32' ? ['cmd.exe'] : ['/bin/sh'];

/** A client that pages text and nothing else. */
const TEXT_ONLY: ClientCapabilities = { viewer: ['text'], download: false, imageEdit: false, sessionAlerts: true };

type Frame = [number, unknown];

describe('handshake capabilities', () => {
  it('accepts a handshake without capabilities, and fills in the defaults', () => {
    assert.equal(isHandshakeMessage({ columns: 80 }), true);
    assert.deepEqual(resolveCapabilities(undefined), DEFAULT_CAPABILITIES);
  });

  it('fills in fields a client left out, and drops unknown view kinds', () => {
    const msg = { viewer: ['text', 'large-text', 'hologram'], download: false };
    assert.equal(isHandshakeMessage({ capabilities: msg }), true);
    assert.deepEqual(resolveCapabilities(msg), {
      viewer: ['text', 'large-text'], download: false, imageEdit: true, sessionAlerts: false,
    });
    assert.deepEqual(resolveCapabilities({ sessionAlerts: true }).viewer, DEFAULT_CAPABILITIES.viewer);
  });

  it('rejects capabilities of the wrong shape', () => {
    assert.equal(isHandshakeMessage({ capabilities: 'all' }), false);
    assert.equal(isHandshakeMessage({ capabilities: [] }), false);
    assert.equal(isHandshakeMessage({ capabilities: { viewer: 'text' } }), false);
    assert.equal(isHandshakeMessage({ capabilities: { viewer: [1] } }), false);
    assert.equal(isHandshakeMessage({ capabilities: { download: 'no' } }), false);
    assert.equal(isHandshakeMessage({ capabilities: { sessionAlerts: 1 } }), false);
  });
});

describe('SessionRegistry with client capabilities', () => {
  let registry: SessionRegistry;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-caps-'));
    registry = new SessionRegistry(tmpDir, logger);
    registry.init();
  });

  afterEach(() => {
    registry.destroyAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const newSession = () =>
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh').info.sessionId;
  const folder: ViewRequest = { root: '/r', isDir: true, entries: [['a.txt', 1]], truncated: false, kind: 'folder' };
  const text: ViewRequest = { root: '/r', isDir: false, entries: [['a.txt', 1]], truncated: false, initial: 'a.txt', kind: 'text' };

  /** Attach a client the way the handshake does, recording its viewer frames. */
  function attach(sessionId: string, capabilities: ClientCapabilities): { client: AttachedClient; frames: Frame[] } {
    const client: AttachedClient = { capabilities };
    const frames: Frame[] = [];
    registry.detachSession(sessionId);
    registry.attachSession(sessionId, noop, noop, client);
    const send = (cmd: number, json: string) => { frames.push([cmd, JSON.parse(json)]); return true; };
    registry.setViewerSender(sessionId, send);
    registry.replayViews(sessionId, send, capabilities);
    return { client, frames };
  }

  it('records the attached client, and clears it only for that client', () => {
    const sessionId = newSession();
    const first = attach(sessionId, TEXT_ONLY).client;
    assert.equal(registry.getAttachedClient(sessionId), first);
    const second = attach(sessionId, DEFAULT_CAPABILITIES).client;
    registry.clearAttachedClient(sessionId, first);
    assert.equal(registry.getAttachedClient(sessionId), second);
    registry.clearAttachedClient(sessionId, second);
    assert.equal(registry.getAttachedClient(sessionId), null);
  });

  it('queues a view the attached client cannot show, with a notice and the alert', async () => {
    const sessionId = newSession();
    const { frames } = attach(sessionId, TEXT_ONLY);
    frames.length = 0;
    const alerts: string[] = [];
    registry.addAlertListener(id => alerts.push(id));

    assert.equal(await registry.requestView(sessionId, folder, noop), 'queued');
    const viewId = registry.getViews(sessionId)[0]!.viewId;
    assert.deepEqual(frames, [[VIEWER_NOTICE, { viewId, message: 'Queued r (folder) for a client that can show it' }]]);
    assert.deepEqual(alerts, [sessionId]);
  });

  it('sends a view the attached client can show', async () => {
    const sessionId = newSession();
    const { frames } = attach(sessionId, TEXT_ONLY);
    frames.length = 0;
    const done = registry.requestView(sessionId, text, noop);
    assert.deepEqual(frames.map(f => f[0]), [VIEWER_OPEN]);
    registry.completeView(sessionId, registry.getViews(sessionId)[0]!.viewId);
    assert.equal(await done, 'closed');
  });

  it('replays only the views the new client can show; the rest stay queued', async () => {
    const sessionId = newSession();
    await registry.requestView(sessionId, folder, noop);
    await registry.requestView(sessionId, text, noop);
    const [folderId, textId] = registry.getViews(sessionId).map(v => v.viewId);

    const { frames } = attach(sessionId, TEXT_ONLY);
    assert.deepEqual(frames.map(f => f[0]), [VIEWER_OPEN, VIEWER_SYNC]);
    assert.deepEqual(frames[1]![1], { viewIds: [textId] });
    assert.deepEqual(registry.getViews(sessionId).map(v => v.viewId), [folderId, textId]);

    // The next client that can show it gets the folder too.
    const later = attach(sessionId, DEFAULT_CAPABILITIES).frames;
    assert.deepEqual(later.at(-1)![1], { viewIds: [folderId, textId] });
  });

  it('releases a waiting CLI as queued when the new client cannot show its view', async () => {
    const sessionId = newSession();
    attach(sessionId, DEFAULT_CAPABILITIES);
    let abort: () => void = noop;
    const done = registry.requestView(sessionId, folder, (cleanup) => { abort = cleanup; });

    attach(sessionId, TEXT_ONLY);
    assert.equal(await done, 'queued');
    // The released CLI's response closing must not drop the queued view.
    abort();
    assert.equal(registry.getViews(sessionId).length, 1);
    // A later capable client still sees it, and closing it resolves nobody.
    attach(sessionId, DEFAULT_CAPABILITIES);
    assert.equal(registry.completeView(sessionId, registry.getViews(sessionId)[0]!.viewId), true);
  });

  it('refuses an image edit while the attached client cannot show images', async () => {
    const sessionId = newSession();
    attach(sessionId, TEXT_ONLY);
    registry.setEditorSender(sessionId, () => true);
    await assert.rejects(
      () => registry.requestEdit(sessionId, '/tmp/p.png', 'iVBO', noop, 'image/png'),
      { message: IMAGE_EDIT_UNSUPPORTED },
    );
    // Text edits still go through.
    const edit = registry.requestEdit(sessionId, '/tmp/f.txt', 'hi', noop);
    registry.completeEdit(sessionId, 'saved', false);
    assert.deepEqual(await edit, { content: 'saved', cancelled: false });
  });

  it('cancels a pending image edit when a client that cannot show images attaches', async () => {
    const sessionId = newSession();
    attach(sessionId, DEFAULT_CAPABILITIES);
    registry.setEditorSender(sessionId, () => true);
    const edit = registry.requestEdit(sessionId, '/tmp/p.png', 'iVBO', noop, 'image/png');

    attach(sessionId, TEXT_ONLY);
    assert.deepEqual(await edit, { content: 'iVBO', cancelled: true });
    assert.equal(registry.getEditorPending(sessionId), undefined, 'the edit slot is free');
  });

  it('keeps a pending text edit when such a client attaches', () => {
    const sessionId = newSession();
    attach(sessionId, DEFAULT_CAPABILITIES);
    registry.setEditorSender(sessionId, () => true);
    void registry.requestEdit(sessionId, '/tmp/f.txt', 'hi', noop);
    attach(sessionId, TEXT_ONLY);
    assert.equal(registry.getEditorPending(sessionId)?.filePath, '/tmp/f.txt');
  });
});

describe('HTTP with client capabilities', () => {
  let registry: SessionRegistry;
  let tmpDir: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-caps-http-'));
    registry = new SessionRegistry(join(tmpDir, 'data'), logger);
    registry.init();
    server = createServer((req, res) => handleHttpRequest(
      req, res, {} as ProfileStore, {} as ThemeStore, {} as ShellStore, registry,
    ));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    port = typeof address === 'object' && address !== null ? address.port : 0;
  });

  afterEach(async () => {
    registry.destroyAll();
    await new Promise<void>(r => server.close(() => r()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function post(path: string, body: unknown): Promise<{ status: number; body: unknown }> {
    const json = JSON.stringify(body);
    return new Promise((resolve, reject) => {
      const req = request({
        host: '127.0.0.1', port, method: 'POST', path,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString()) }));
      });
      req.on('error', reject);
      req.end(json);
    });
  }

  /** A session with a client attached; returns the frames sent to it. */
  function sessionWith(capabilities?: ClientCapabilities): { sessionId: string; frames: Frame[] } {
    const sessionId = registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh').info.sessionId;
    const frames: Frame[] = [];
    registry.attachSession(sessionId, noop, noop, capabilities ? { capabilities } : undefined);
    registry.setViewerSender(sessionId, (cmd, json) => { frames.push([cmd, JSON.parse(json)]); return true; });
    registry.setDownloadSender(sessionId, (fileName, fileSize, token) => { frames.push([DOWNLOAD_START, { fileName, fileSize, token }]); });
    registry.setEditorSender(sessionId, () => true);
    return { sessionId, frames };
  }

  it('answers a view the attached client cannot show with 202 and a notice', async () => {
    const { sessionId, frames } = sessionWith(TEXT_ONLY);
    const image = join(tmpDir, 'shot.png');
    writeFileSync(image, Buffer.from([0x89, 0x50]));
    const res = await post(`/api/sessions/${sessionId}/viewer`, { path: image });
    assert.equal(res.status, 202);
    assert.deepEqual(res.body, { ok: true, queued: true });
    assert.deepEqual(frames.map(f => f[0]), [VIEWER_NOTICE]);
    assert.match(JSON.stringify(frames[0]![1]), /Queued shot\.png \(image\)/);
  });

  it('refuses a download while the attached client cannot receive files', async () => {
    const { sessionId, frames } = sessionWith(TEXT_ONLY);
    const file = join(tmpDir, 'out.zip');
    writeFileSync(file, 'x');
    const res = await post(`/api/sessions/${sessionId}/download`, { filePath: file });
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: DOWNLOAD_UNSUPPORTED });
    assert.deepEqual(frames, []);
  });

  it('still sends a download to a client that declared no capabilities', async () => {
    const { sessionId, frames } = sessionWith();
    const file = join(tmpDir, 'out.zip');
    writeFileSync(file, 'x');
    const res = await post(`/api/sessions/${sessionId}/download`, { filePath: file });
    assert.equal(res.status, 200);
    assert.deepEqual(frames.map(f => f[0]), [DOWNLOAD_START]);
  });

  it('refuses an image edit with 503 and the reason', async () => {
    const { sessionId } = sessionWith(TEXT_ONLY);
    const res = await post(`/api/sessions/${sessionId}/editor`, { filePath: '/tmp/p.png', content: 'iVBO', contentType: 'image/png' });
    assert.equal(res.status, 503);
    assert.deepEqual(res.body, { error: IMAGE_EDIT_UNSUPPORTED });
  });
});
