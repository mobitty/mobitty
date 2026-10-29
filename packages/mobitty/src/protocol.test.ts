import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { WebSocket, WebSocketServer } from 'ws';
import { computeAutoInterval, handleConnection, isTypedInput, relaysAlert, relaysNotification } from './protocol.ts';
import { INPUT, isUpdateSettingsMessage, SESSION_ALERT, SESSION_NOTIFICATION, SET_SESSION_INFO, VIEWER_NOTICE } from './types.ts';
import type { ServerState } from './types.ts';
import { SessionRegistry } from './sessions.ts';
import type { ViewRequest } from './sessions.ts';
import { ShellStore } from './shells.ts';
import { Logger, LogWriter } from './logger.ts';
import { writePty } from './pty.ts';

describe('isUpdateSettingsMessage — imagePasteDir', () => {
  it('accepts relative directory', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: 'images' }), true);
  });

  it('accepts nested relative directory', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: 'sub/images' }), true);
  });

  it('rejects absolute path', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: '/tmp/evil' }), false);
  });

  it('allows traversal (caught at use-time containment check)', () => {
    assert.equal(isUpdateSettingsMessage({ imagePasteDir: '../../etc' }), true);
  });
});

describe('computeAutoInterval', () => {
  it('stays at 30fps with oscillating RTT (audit scenario)', () => {
    // Simulates the RTT pattern from the protocol audit:
    // 13 → 109 → 9 → 44 → 9 → 78
    const rtts = [13, 109, 9, 44, 9, 78];
    let smooth = 33;
    let interval = 33; // start at 30fps
    for (const rtt of rtts) {
      const r = computeAutoInterval(rtt, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 33, 'should stay at 30fps with oscillating RTT');
  });

  it('upgrades to 60fps after consistent low RTT', () => {
    let smooth = 33;
    let interval = 33;
    // Feed several consistently low RTT samples
    for (let i = 0; i < 10; i++) {
      const r = computeAutoInterval(10, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 16, 'should upgrade to 60fps after consistent low RTT');
  });

  it('needs ~3 low-RTT samples to upgrade from 30fps', () => {
    let smooth = 33;
    let interval = 33;

    // 1st sample
    let r = computeAutoInterval(10, smooth, interval);
    smooth = r.smoothRtt; interval = r.syncIntervalMs;
    assert.equal(interval, 33, 'still 30fps after 1 sample');

    // 2nd sample
    r = computeAutoInterval(10, smooth, interval);
    smooth = r.smoothRtt; interval = r.syncIntervalMs;
    assert.equal(interval, 33, 'still 30fps after 2 samples');

    // 3rd sample
    r = computeAutoInterval(10, smooth, interval);
    smooth = r.smoothRtt; interval = r.syncIntervalMs;
    assert.equal(interval, 16, 'upgrades to 60fps after 3 samples');
  });

  it('single spike does not downgrade from 60fps', () => {
    // Start with low smoothRtt (already at 60fps)
    let smooth = 15;
    let interval = 16;

    // One high RTT spike
    const r = computeAutoInterval(120, smooth, interval);
    assert.equal(r.syncIntervalMs, 16, 'single spike should not downgrade');
  });

  it('downgrades to 30fps after sustained high RTT', () => {
    let smooth = 15;
    let interval = 16; // at 60fps

    // Feed consistently high RTT
    for (let i = 0; i < 10; i++) {
      const r = computeAutoInterval(80, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 33, 'should downgrade to 30fps after sustained high RTT');
  });

  it('stays in dead zone without changing', () => {
    // smoothRtt in dead zone [20, 50] — should keep current interval
    const r30 = computeAutoInterval(35, 35, 33);
    assert.equal(r30.syncIntervalMs, 33, 'keeps 30fps in dead zone');

    const r60 = computeAutoInterval(35, 35, 16);
    assert.equal(r60.syncIntervalMs, 16, 'keeps 60fps in dead zone');
  });

  it('handles extreme RTT spike gracefully', () => {
    // The audit saw a 1515ms spike — should not crash, should push toward downgrade
    let smooth = 20;
    let interval = 16;
    const r = computeAutoInterval(1515, smooth, interval);
    assert.ok(r.smoothRtt > 50, 'extreme spike pushes smoothRtt above downgrade threshold');
  });

  // High-RTT scaling tier (smoothRtt > 100ms → 0.5×RTT, capped at 250ms)
  it('scales interval to 0.5×RTT at 150ms', () => {
    // Feed consistent 150ms RTT until smoothRtt stabilizes above 100
    let smooth = 33;
    let interval = 33;
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(150, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 75, 'should scale to 75ms at 150ms RTT');
  });

  it('scales interval to 0.5×RTT at 300ms', () => {
    let smooth = 33;
    let interval = 33;
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(300, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 150, 'should scale to 150ms at 300ms RTT');
  });

  it('caps interval at 250ms for very high RTT', () => {
    let smooth = 33;
    let interval = 33;
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(600, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 250, 'should cap at 250ms (4fps floor)');
  });

  it('recovers from high RTT back to 60fps', () => {
    // Start at high RTT
    let smooth = 300;
    let interval = 150;
    // Feed consistently low RTT
    for (let i = 0; i < 20; i++) {
      const r = computeAutoInterval(10, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.equal(interval, 16, 'should recover to 60fps after sustained low RTT');
  });

  it('transitions smoothly across 100ms boundary', () => {
    // Start at 30fps (smoothRtt ~80)
    let smooth = 80;
    let interval = 33;
    // RTT rises to 120 — should cross into scaling tier
    for (let i = 0; i < 10; i++) {
      const r = computeAutoInterval(120, smooth, interval);
      smooth = r.smoothRtt;
      interval = r.syncIntervalMs;
    }
    assert.ok(smooth > 100, 'smoothRtt should cross 100ms');
    assert.ok(interval > 33, 'interval should exceed 30fps tier');
    assert.equal(interval, Math.min(Math.round(smooth * 0.5), 250), 'interval should be 0.5×smoothRtt');
  });
});

describe('relaysAlert / relaysNotification', () => {
  it('relays another session\'s bell and queued view with or without sessionAlerts', () => {
    for (const sessionAlerts of [false, true]) {
      assert.equal(relaysAlert('b', 'bell', 'a', sessionAlerts), true);
      assert.equal(relaysAlert('b', 'view', 'a', sessionAlerts), true);
      assert.equal(relaysNotification('b', 'a', sessionAlerts), true);
    }
  });
  it('relays the attached session\'s bell and notification only with sessionAlerts', () => {
    assert.equal(relaysAlert('a', 'bell', 'a', false), false);
    assert.equal(relaysAlert('a', 'bell', 'a', true), true);
    assert.equal(relaysNotification('a', 'a', false), false);
    assert.equal(relaysNotification('a', 'a', true), true);
  });
  it('never relays the attached session\'s queued view as an alert', () => {
    assert.equal(relaysAlert('a', 'view', 'a', false), false);
    assert.equal(relaysAlert('a', 'view', 'a', true), false);
  });
  it('relays everything before the handshake attached a session', () => {
    assert.equal(relaysAlert('a', 'bell', null, false), true);
    assert.equal(relaysNotification('a', null, false), true);
  });
});

describe('isTypedInput', () => {
  it('counts keys and pasted text', () => {
    assert.equal(isTypedInput('a'), true);
    assert.equal(isTypedInput('\r'), true);
    assert.equal(isTypedInput('\x1b[A'), true);
  });

  it('does not count focus or mouse reports', () => {
    assert.equal(isTypedInput('\x1b[I'), false);
    assert.equal(isTypedInput('\x1b[O'), false);
    assert.equal(isTypedInput('\x1b[<0;10;5M'), false);
    assert.equal(isTypedInput('\x1b[M #!'), false);
  });
});

const testShellArgv = process.platform === 'win32' ? ['cmd.exe'] : ['/bin/sh'];

interface Frame {
  cmd: number;
  text: string;
}

/** A client attached over a real WebSocket, recording every server frame. */
interface TestClient {
  frames: Frame[];
  /** SET_SESSION_INFO of the attach. */
  info: Record<string, unknown>;
  /** Resolves once every frame the server sent before this call has arrived. */
  flush(): Promise<void>;
  /** Send INPUT to the attached session. */
  input(data: string): void;
  /** Resolves with the close code once the socket closes. */
  closed: Promise<number>;
}

describe('handleConnection', { skip: process.platform === 'win32' }, () => {
  let tmpDir: string;
  let registry: SessionRegistry;
  let server: Server;
  let wss: WebSocketServer;
  let port: number;
  const clients: WebSocket[] = [];

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mobitty-protocol-test-'));
    const logger = new Logger(new LogWriter(join(tmpDir, 'logs'), 3_600_000, 3_600_000), 'error', 'error');
    registry = new SessionRegistry(join(tmpDir, 'data'), logger);
    registry.init();
    const state: ServerState = {
      clientCount: 0,
      config: {
        port: 0, host: '127.0.0.1', terminalType: 'xterm-256color', prefsJson: '{}',
        dataFolder: join(tmpDir, 'data'), startDir: tmpDir, maxPayloadBytes: 1 << 20,
        maxConnections: 0, maxSessions: 0,
      },
    };
    const shellStore = new ShellStore(join(tmpDir, 'data'));
    server = createServer();
    // Reject on a refused bind (EPERM in a sandbox) so the suite fails rather
    // than hangs. Listen before attaching the WebSocketServer: it re-emits the
    // server's `error` on itself, where nothing listens, and that throw would
    // keep this reject from running.
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    wss = new WebSocketServer({ server });
    wss.on('connection', (ws, req) => handleConnection(ws, req, state, registry, shellStore, logger));
    const address = server.address();
    assert.ok(address !== null && typeof address === 'object');
    port = address.port;
  });

  afterEach(async () => {
    for (const ws of clients.splice(0)) ws.terminate();
    registry.destroyAll();
    await new Promise<void>(r => wss.close(() => r()));
    await new Promise<void>(r => server.close(() => r()));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  async function attach(handshake: Record<string, unknown>): Promise<TestClient> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
    clients.push(ws);
    const frames: Frame[] = [];
    const info = new Promise<Record<string, unknown>>((resolve, reject) => {
      ws.on('message', (data: Buffer) => {
        const frame = { cmd: data[0] ?? 0, text: data.subarray(1).toString('utf-8') };
        frames.push(frame);
        if (frame.cmd === SET_SESSION_INFO) resolve(JSON.parse(frame.text));
      });
      ws.on('close', (code) => reject(new Error(`closed ${code}`)));
    });
    const closed = new Promise<number>(resolve => ws.on('close', (code) => resolve(code)));
    await new Promise<void>((resolve, reject) => { ws.on('open', resolve); ws.on('error', reject); });
    ws.send(Buffer.from(JSON.stringify(handshake)));
    const flush = () => new Promise<void>(resolve => { ws.once('pong', () => resolve()); ws.ping(); });
    const input = (data: string) => ws.send(Buffer.concat([Buffer.from([INPUT]), Buffer.from(data)]));
    return { frames, info: await info, flush, input, closed };
  }

  const newSession = (scrollback = 5000) =>
    registry.createSession(testShellArgv, 'xterm-256color', 80, 24, scrollback, 'sh');

  /** Resolve once the session raises an alert, after every earlier listener ran. */
  const nextAlert = (sessionId: string) => new Promise<void>(resolve => {
    const unsub = registry.addAlertListener((id) => { if (id === sessionId) { unsub(); resolve(); } });
  });
  const nextNotification = (sessionId: string) => new Promise<void>(resolve => {
    const unsub = registry.addNotificationListener((id) => { if (id === sessionId) { unsub(); resolve(); } });
  });

  const framesOf = (client: TestClient, cmd: number) => client.frames.filter(f => f.cmd === cmd);

  it('relays the attached session\'s bell and notification with sessionAlerts', async () => {
    const { info, handle } = newSession();
    const client = await attach({ sessionId: info.sessionId, capabilities: { sessionAlerts: true } });

    const bell = nextAlert(info.sessionId);
    writePty(handle, "printf '\\a'\n");
    await bell;
    const notified = nextNotification(info.sessionId);
    writePty(handle, "printf '\\033]9;done\\007'\n");
    await notified;
    await client.flush();

    assert.deepEqual(framesOf(client, SESSION_ALERT).map(f => f.text), [info.sessionId]);
    const notes: unknown[] = framesOf(client, SESSION_NOTIFICATION).map(f => JSON.parse(f.text));
    assert.equal(notes.length, 1);
    assert.partialDeepStrictEqual(notes[0], { sessionId: info.sessionId, body: 'done', sessionName: info.name });
  });

  // Focus and mouse reports are covered by the isTypedInput tests: sent to the
  // shell here, its line editor rings for the unbound sequence and raises the
  // alert again.
  it('clears the attached session\'s alert when the user types', async () => {
    const { info, handle } = newSession();
    const client = await attach({ sessionId: info.sessionId, capabilities: { sessionAlerts: true } });
    const hasAlert = () => registry.listSessions().find(s => s.sessionId === info.sessionId)?.hasAlert;

    const bell = nextAlert(info.sessionId);
    writePty(handle, "printf '\\a'\n");
    await bell;
    assert.equal(hasAlert(), true);

    client.input('x');
    await client.flush();
    assert.equal(hasAlert(), false);
  });

  it('does not relay the attached session\'s bell or notification without sessionAlerts', async () => {
    const { info, handle } = newSession();
    const other = newSession();
    const client = await attach({ sessionId: info.sessionId });

    const bell = nextAlert(info.sessionId);
    writePty(handle, "printf '\\a'\n");
    await bell;
    const notified = nextNotification(info.sessionId);
    writePty(handle, "printf '\\033]9;done\\007'\n");
    await notified;
    // Another session's bell still arrives.
    const otherBell = nextAlert(other.info.sessionId);
    writePty(other.handle, "printf '\\a'\n");
    await otherBell;
    await client.flush();

    assert.deepEqual(framesOf(client, SESSION_ALERT).map(f => f.text), [other.info.sessionId]);
    assert.deepEqual(framesOf(client, SESSION_NOTIFICATION), []);
  });

  it('never relays a view queued for the attached session as a bell', async () => {
    const { info } = newSession();
    const client = await attach({ sessionId: info.sessionId, capabilities: { sessionAlerts: true, viewer: ['text'] } });

    // An image this client cannot show is queued, and the session's alert raised.
    const alert = nextAlert(info.sessionId);
    const request: ViewRequest = { root: '/r', isDir: false, initial: 'a.png', entries: [], truncated: false, kind: 'image' };
    assert.equal(await registry.requestView(info.sessionId, request, () => {}), 'queued');
    await alert;
    await client.flush();

    assert.equal(framesOf(client, VIEWER_NOTICE).length, 1);
    assert.deepEqual(framesOf(client, SESSION_ALERT), []);
  });

  it('keeps the session\'s scrollback when the attach handshake has none', async () => {
    const { info } = newSession(1234);
    const client = await attach({ sessionId: info.sessionId });
    assert.equal(client.info['scrollback'], 1234);
    assert.equal(registry.getHeadless(info.sessionId)?.options.scrollback, 1234);
  });

  it('applies a handshake scrollback and reports it in SET_SESSION_INFO and the session list', async () => {
    const { info } = newSession(1234);
    const client = await attach({ sessionId: info.sessionId, scrollback: 2000 });
    assert.equal(client.info['scrollback'], 2000);
    assert.equal(registry.listSessions().find(s => s.sessionId === info.sessionId)?.scrollback, 2000);
  });

  it('closes the attached connection with 4004 when its session is deleted', async () => {
    const { info } = newSession();
    const other = newSession();
    const client = await attach({ sessionId: info.sessionId });
    const bystander = await attach({ sessionId: other.info.sessionId });

    assert.equal(registry.deleteSession(info.sessionId), true);
    const timeout = new Promise<string>(resolve => setTimeout(() => resolve('still open'), 1000).unref());
    assert.equal(await Promise.race([client.closed, timeout]), 4004);

    // A connection attached to another session stays open.
    await bystander.flush();
  });

  it('deletes a session with no connection attached', () => {
    const { info } = newSession();
    assert.equal(registry.deleteSession(info.sessionId), true);
    assert.equal(registry.getSession(info.sessionId), undefined);
  });
});
