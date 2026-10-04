import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MAX_VIEWS_PER_SESSION, SessionRegistry } from './sessions.ts';
import { handleHttpRequest } from './http.ts';
import { VIEWER_CLOSE, VIEWER_OPEN, VIEWER_SYNC } from './types.ts';
import {
  listViewTree, readViewFile, resolveInRoot,
  MAX_VIEW_ENTRIES, MAX_VIEW_TEXT_BYTES,
} from './viewer.ts';
import type { ProfileStore } from './profiles.ts';
import type { ThemeStore } from './themes.ts';
import type { ShellStore } from './shells.ts';

const noop = () => {};
const logger = { debug: noop, info: noop, warn: noop, error: noop, isEnabled: () => false };
const testShellArgv = process.platform === 'win32' ? ['cmd.exe'] : ['/bin/sh'];

function hasGit(): boolean {
  try { execFileSync('git', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

describe('resolveInRoot', () => {
  const root = join(tmpdir(), 'view-root');

  it('accepts nested relative paths', () => {
    assert.equal(resolveInRoot(root, 'a/b.txt'), join(root, 'a', 'b.txt'));
  });

  it('accepts paths that normalize back inside the root', () => {
    assert.equal(resolveInRoot(root, 'a/../b.txt'), join(root, 'b.txt'));
  });

  it('rejects escapes, absolute paths, and the root itself', () => {
    assert.equal(resolveInRoot(root, '../x'), null);
    assert.equal(resolveInRoot(root, 'a/../../x'), null);
    assert.equal(resolveInRoot(root, '/etc/passwd'), null);
    assert.equal(resolveInRoot(root, ''), null);
    assert.equal(resolveInRoot(root, '.'), null);
  });
});

describe('listViewTree / readViewFile', () => {
  let dir: string;

  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'mobitty-viewer-test-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('walks a plain folder, skipping node_modules and symlinked dirs', async () => {
    mkdirSync(join(dir, 'src'));
    mkdirSync(join(dir, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(dir, 'README.md'), '# hi');
    writeFileSync(join(dir, 'src', 'a.ts'), 'export {};');
    writeFileSync(join(dir, 'node_modules', 'dep', 'index.js'), '');
    if (process.platform !== 'win32') {
      symlinkSync(join(dir, 'src'), join(dir, 'loop'));
      symlinkSync(join(dir, 'README.md'), join(dir, 'readme-link.md'));
    }

    const { entries, truncated } = await listViewTree(dir);
    const paths = entries.map(([p]) => p).sort();
    const expected = process.platform === 'win32'
      ? ['README.md', 'src/a.ts']
      : ['README.md', 'readme-link.md', 'src/a.ts'];
    assert.deepEqual(paths, expected);
    assert.equal(truncated, false);
    assert.deepEqual(entries.find(([p]) => p === 'README.md'), ['README.md', 4]);
  });

  it('honours .gitignore inside a git work tree', { skip: !hasGit() }, async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), 'dist/\n');
    mkdirSync(join(dir, 'dist'));
    mkdirSync(join(dir, 'sub'));
    writeFileSync(join(dir, 'dist', 'bundle.js'), '');
    writeFileSync(join(dir, 'sub', 'kept.txt'), 'x');

    const whole = await listViewTree(dir);
    assert.deepEqual(whole.entries.map(([p]) => p).sort(), ['.gitignore', 'sub/kept.txt']);

    // A subfolder of the repo lists relative to itself.
    const sub = await listViewTree(join(dir, 'sub'));
    assert.deepEqual(sub.entries, [['kept.txt', 1]]);
  });

  it('walks a folder that is itself gitignored instead of listing nothing', { skip: !hasGit() }, async () => {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    writeFileSync(join(dir, '.gitignore'), 'tmp/\n');
    mkdirSync(join(dir, 'tmp', 'fixture'), { recursive: true });
    writeFileSync(join(dir, 'tmp', 'fixture', 'notes.txt'), 'hi');

    const { entries } = await listViewTree(join(dir, 'tmp', 'fixture'));
    assert.deepEqual(entries, [['notes.txt', 2]]);
  });

  it('stops at MAX_VIEW_ENTRIES and reports truncation', async () => {
    for (let i = 0; i <= MAX_VIEW_ENTRIES; i++) writeFileSync(join(dir, `f${i}`), '');
    const { entries, truncated } = await listViewTree(dir);
    assert.equal(entries.length, MAX_VIEW_ENTRIES);
    assert.equal(truncated, true);
  });

  it('reads text, image, binary, too-large, and error kinds', async () => {
    writeFileSync(join(dir, 'a.txt'), 'hello');
    writeFileSync(join(dir, 'p.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    writeFileSync(join(dir, 'b.bin'), Buffer.from([1, 0, 2]));
    writeFileSync(join(dir, 'big.log'), Buffer.alloc(MAX_VIEW_TEXT_BYTES + 1, 0x61));

    const text = await readViewFile(dir, 'a.txt');
    assert.equal(text.kind, 'text');
    assert.equal(text.content, 'hello');
    assert.equal(text.size, 5);
    assert.ok(text.mtimeMs > 0);

    const image = await readViewFile(dir, 'p.png');
    assert.equal(image.kind, 'image');
    assert.equal(image.contentType, 'image/png');
    assert.equal(image.content, Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));

    assert.equal((await readViewFile(dir, 'b.bin')).kind, 'binary');
    const big = await readViewFile(dir, 'big.log');
    assert.equal(big.kind, 'too-large');
    assert.equal(big.content, undefined);

    const missing = await readViewFile(dir, 'nope.txt');
    assert.equal(missing.kind, 'error');
    const escaped = await readViewFile(dir, '../etc/passwd');
    assert.equal(escaped.kind, 'error');
    assert.match(escaped.error ?? '', /outside/);
  });
});

describe('SessionRegistry viewer lifecycle', () => {
  let registry: SessionRegistry;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-viewer-reg-'));
    registry = new SessionRegistry(tmpDir, logger);
    registry.init();
  });

  afterEach(() => {
    registry.destroyAll();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const newSession = () =>
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh').info.sessionId;
  const listing = { root: '/r', isDir: true, entries: [['a.txt', 1]] as [string, number][], truncated: false };

  it('rejects an unknown session', async () => {
    await assert.rejects(() => registry.requestView('nonexistent', listing, noop), { message: 'Session not found' });
  });

  it('queues without a sender, raises the alert, and replays on attach', async () => {
    const sessionId = newSession();
    const alerts: string[] = [];
    registry.addAlertListener(id => alerts.push(id));
    assert.equal(await registry.requestView(sessionId, listing, noop), 'queued');
    assert.equal(await registry.requestView(sessionId, { ...listing, root: '/s' }, noop), 'queued');
    assert.deepEqual(alerts, [sessionId, sessionId]);
    assert.deepEqual(registry.getViews(sessionId).map(v => v.root), ['/r', '/s']);

    const frames: Array<[number, unknown]> = [];
    const send = (cmd: number, json: string) => { frames.push([cmd, JSON.parse(json)]); return true; };
    registry.replayViews(sessionId, send);
    const ids = registry.getViews(sessionId).map(v => v.viewId);
    assert.deepEqual(frames.map(f => f[0]), [VIEWER_OPEN, VIEWER_OPEN, VIEWER_SYNC]);
    assert.deepEqual(frames[2]![1], { viewIds: ids });

    // A queued view stays until the user closes it.
    assert.equal(registry.completeView(sessionId, ids[0]!), true);
    assert.deepEqual(registry.getViews(sessionId).map(v => v.viewId), [ids[1]]);
  });

  it('a send failure queues instead of rejecting', async () => {
    const sessionId = newSession();
    registry.setViewerSender(sessionId, () => false);
    assert.equal(await registry.requestView(sessionId, listing, noop), 'queued');
    assert.equal(registry.getViews(sessionId).length, 1);
  });

  it('a repeat of a queued view supersedes it', async () => {
    const sessionId = newSession();
    await registry.requestView(sessionId, listing, noop);
    const first = registry.getViews(sessionId)[0]!.viewId;
    await registry.requestView(sessionId, listing, noop);
    const views = registry.getViews(sessionId);
    assert.equal(views.length, 1);
    assert.notEqual(views[0]!.viewId, first);
  });

  it('drops the oldest queued view past the cap', async () => {
    const sessionId = newSession();
    for (let i = 0; i <= MAX_VIEWS_PER_SESSION; i++) {
      await registry.requestView(sessionId, { ...listing, root: `/r${i}` }, noop);
    }
    const roots = registry.getViews(sessionId).map(v => v.root);
    assert.equal(roots.length, MAX_VIEWS_PER_SESSION);
    assert.equal(roots[0], '/r1');
  });

  it('sends VIEWER_OPEN, stacks views, and resolves each on its own done', async () => {
    const sessionId = newSession();
    const frames: Array<[number, unknown]> = [];
    registry.setViewerSender(sessionId, (cmd, json) => { frames.push([cmd, JSON.parse(json)]); return true; });

    const first = registry.requestView(sessionId, listing, noop);
    const second = registry.requestView(sessionId, listing, noop);
    assert.deepEqual(frames.map(f => f[0]), [VIEWER_OPEN, VIEWER_OPEN]);
    const a = frames[0]![1] as { viewId: number; root: string };
    const b = frames[1]![1] as { viewId: number };
    assert.equal(a.root, '/r');
    assert.deepEqual(registry.getView(sessionId, a.viewId), a);

    assert.equal(registry.completeView(sessionId, b.viewId + 1), false, 'unknown view id is ignored');
    assert.equal(registry.completeView(sessionId, b.viewId), true);
    assert.equal(await second, 'closed');
    assert.deepEqual(registry.getViews(sessionId), [a]);
    assert.equal(registry.completeView(sessionId, a.viewId), true);
    assert.equal(await first, 'closed');
  });

  it('CLI abort clears the view and tells the client to close it', async () => {
    const sessionId = newSession();
    const cmds: number[] = [];
    registry.setViewerSender(sessionId, (cmd) => { cmds.push(cmd); return true; });
    let abort: () => void = noop;
    const done = registry.requestView(sessionId, listing, (cleanup) => { abort = cleanup; });
    abort();
    await done;
    assert.deepEqual(cmds, [VIEWER_OPEN, VIEWER_CLOSE]);
    assert.deepEqual(registry.getViews(sessionId), []);
  });

  it('abort after a normal close does not touch other views', async () => {
    const sessionId = newSession();
    registry.setViewerSender(sessionId, () => true);
    let abortFirst: () => void = noop;
    const first = registry.requestView(sessionId, listing, (cleanup) => { abortFirst = cleanup; });
    registry.completeView(sessionId, registry.getViews(sessionId)[0]!.viewId);
    await first;

    void registry.requestView(sessionId, listing, noop);
    const second = registry.getViews(sessionId);
    abortFirst();
    assert.deepEqual(registry.getViews(sessionId), second);
  });

  it('a stale connection clearing its sender does not wipe the replacement', async () => {
    const sessionId = newSession();
    const stale = () => true;
    const live = () => true;
    registry.setViewerSender(sessionId, stale);
    registry.setViewerSender(sessionId, live);
    registry.clearViewerSender(sessionId, stale);
    assert.equal(registry.sendViewer(sessionId, VIEWER_OPEN, '{}'), true);
  });

  it('deleting the session resolves waiting views', async () => {
    const sessionId = newSession();
    registry.setViewerSender(sessionId, () => true);
    const done = registry.requestView(sessionId, listing, noop);
    registry.deleteSession(sessionId);
    assert.equal(await done, 'closed');
  });
});

describe('POST /api/sessions/{id}/viewer', () => {
  let registry: SessionRegistry;
  let tmpDir: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-viewer-http-'));
    registry = new SessionRegistry(join(tmpDir, 'data'), logger);
    registry.init();
    server = createServer((req, res) => handleHttpRequest(
      req, res, {} as ProfileStore, {} as ThemeStore, {} as ShellStore, registry,
    ));
    await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    registry.destroyAll();
    await new Promise<void>(r => server.close(() => r()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function post(sessionId: string, body: unknown): { response: Promise<{ status: number; body: string }>; abort: () => void } {
    const json = JSON.stringify(body);
    let abort: () => void = noop;
    const response = new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = request({
        host: '127.0.0.1', port, method: 'POST', path: `/api/sessions/${sessionId}/viewer`,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(json) },
      }, res => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString() }));
      });
      req.on('error', reject);
      abort = () => req.destroy();
      req.end(json);
    });
    return { response, abort };
  }

  const newSession = () =>
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, 5000, 'sh').info.sessionId;

  it('opens a folder view and answers 200 once the user closes it', async () => {
    const sessionId = newSession();
    const folder = join(tmpDir, 'proj');
    mkdirSync(folder);
    writeFileSync(join(folder, 'notes.txt'), 'hi');
    let opened: (open: { viewId: number; isDir: boolean; entries: unknown }) => void = noop;
    const openSeen = new Promise<{ viewId: number; isDir: boolean; entries: unknown }>(r => { opened = r; });
    registry.setViewerSender(sessionId, (cmd, json) => { if (cmd === VIEWER_OPEN) opened(JSON.parse(json)); return true; });

    const { response } = post(sessionId, { path: folder });
    const open = await openSeen;
    assert.equal(open.isDir, true);
    assert.deepEqual(open.entries, [['notes.txt', 2]]);
    registry.completeView(sessionId, open.viewId);
    const res = await response;
    assert.equal(res.status, 200);
  });

  it('roots a file view at its parent with the file as the initial selection', async () => {
    const sessionId = newSession();
    const file = join(tmpDir, 'README.md');
    writeFileSync(file, '# x');
    let opened: (open: { viewId: number; root: string; isDir: boolean; initial?: string }) => void = noop;
    const openSeen = new Promise<{ viewId: number; root: string; isDir: boolean; initial?: string }>(r => { opened = r; });
    registry.setViewerSender(sessionId, (cmd, json) => { if (cmd === VIEWER_OPEN) opened(JSON.parse(json)); return true; });

    const { response } = post(sessionId, { path: file });
    const open = await openSeen;
    assert.equal(open.root, tmpDir);
    assert.equal(open.isDir, false);
    assert.equal(open.initial, 'README.md');
    registry.completeView(sessionId, open.viewId);
    assert.equal((await response).status, 200);
  });

  it('answers 202 at once when no client is attached', async () => {
    const sessionId = newSession();
    const res = await post(sessionId, { path: tmpDir }).response;
    assert.equal(res.status, 202);
    assert.deepEqual(JSON.parse(res.body), { ok: true, queued: true });
    assert.equal(registry.getViews(sessionId)[0]!.root, tmpDir);
  });

  it('rejects relative and missing paths', async () => {
    const sessionId = newSession();
    assert.equal((await post(sessionId, { path: 'rel/path' }).response).status, 400);
    assert.equal((await post(sessionId, { path: join(tmpDir, 'missing') }).response).status, 404);
  });

  it('a CLI that disconnects closes the view', async () => {
    const sessionId = newSession();
    const cmds: number[] = [];
    let opened: () => void = noop;
    const openSeen = new Promise<void>(r => { opened = r; });
    let closed: () => void = noop;
    const closeSeen = new Promise<void>(r => { closed = r; });
    registry.setViewerSender(sessionId, (cmd) => {
      cmds.push(cmd);
      if (cmd === VIEWER_OPEN) opened();
      if (cmd === VIEWER_CLOSE) closed();
      return true;
    });

    const { response, abort } = post(sessionId, { path: tmpDir });
    response.catch(noop);
    await openSeen;
    abort();
    await closeSeen;
    assert.deepEqual(cmds, [VIEWER_OPEN, VIEWER_CLOSE]);
    assert.deepEqual(registry.getViews(sessionId), []);
  });
});
