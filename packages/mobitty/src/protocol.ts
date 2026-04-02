import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  SET_WINDOW_TITLE, SET_PREFERENCES, SET_SESSION_INFO,
  STATE_UPDATE, STATE_FULL,
  INPUT, RESIZE_TERMINAL, UPDATE_SETTINGS, JSON_DATA, CLIENT_LOG,
  CLIPBOARD_IMAGE, CLIPBOARD_IMAGE_ACK, RTT_REPORT, SESSION_ALERT, SESSION_NOTIFICATION,
  EDITOR_OPEN, EDITOR_DONE,
  HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
  isResizeMessage, isAuthMessage, isUpdateSettingsMessage,
  isClientLogMessage,
} from './types.ts';
import type { ServerState } from './types.ts';
const DEFAULT_SCROLLBACK = 5000;
import { resolve } from 'node:path';
import { writePty } from './pty.ts';
import { writeImageToSystemClipboard, writeImageToFile, getProcessCwd } from './clipboard.ts';
import type { SessionRegistry } from './sessions.ts';
import type { ShellStore } from './shells.ts';
import type { Logger, SessionLogger } from './logger.ts';
import { captureSnapshot, generateDiff, serializeFullState, compareSnapshots } from './diff.ts';
import type { FrameSnapshot } from './diff.ts';
import { resolveEditorBin } from './editor-bin.ts';
import headlessPkg from '@xterm/headless';
const { Terminal: HeadlessTerminal } = headlessPkg;

const VERIFY_DIFF = process.env['MOBITTY_VERIFY_DIFF'] === '1';
const EDITOR_BIN_PATH = resolveEditorBin();

/** Update EMA-smoothed RTT and decide sync interval.
 *  < 20ms → 60fps (16ms), 20–50ms → dead zone, 50–100ms → 30fps (33ms),
 *  > 100ms → scales linearly at 0.5×RTT, capped at 250ms (4fps floor). */
export function computeAutoInterval(rtt: number, prevSmooth: number, currentInterval: number): { smoothRtt: number; syncIntervalMs: number } {
  const smoothRtt = 0.3 * rtt + 0.7 * prevSmooth;
  let syncIntervalMs: number;
  if (smoothRtt < 20) {
    syncIntervalMs = 16;
  } else if (smoothRtt <= 50) {
    syncIntervalMs = currentInterval;
  } else if (smoothRtt <= 100) {
    syncIntervalMs = 33;
  } else {
    syncIntervalMs = Math.min(Math.round(smoothRtt * 0.5), 250);
  }
  return { smoothRtt, syncIntervalMs };
}

function sendBinary(ws: WebSocket, cmd: number, payload: string): void {
  const data = Buffer.from(String.fromCharCode(cmd) + payload);
  ws.send(data);
}

function sendClipboardImageAck(ws: WebSocket, requestId: number, status: number, errorJson?: string): void {
  const errorBytes = status === 1 && errorJson ? Buffer.from(errorJson, 'utf-8') : Buffer.alloc(0);
  const buf = Buffer.allocUnsafe(6 + errorBytes.length);
  buf[0] = CLIPBOARD_IMAGE_ACK;
  buf.writeUInt32BE(requestId, 1);
  buf[5] = status;
  if (errorBytes.length > 0) errorBytes.copy(buf, 6);
  ws.send(buf);
}

export function handleConnection(ws: WebSocket, req: IncomingMessage, state: ServerState, registry: SessionRegistry, shellStore: ShellStore, logger: Logger): void {
  const address = req.socket.remoteAddress ?? 'unknown';

  state.clientCount++;
  logger.debug('WS connected', { address, clientCount: state.clientCount });

  let syncIntervalMs = 33; // adaptive; adjusted continuously by RTT
  let smoothRtt = 33;      // EMA of RTT for adaptive sync interval
  let imagePasteDir: string | undefined;
  let remoteEditor = false;
  let themeForeground: string | undefined;
  let themeBackground: string | undefined;

  let sessionId: string | null = null;
  let sessionLogger: SessionLogger | null = null;
  let pendingClientLogs: Buffer[] = [];
  let lastSnapshot: FrameSnapshot | null = null;
  let syncCleanup: (() => void) | null = null;
  let onSyncResize: ((cols: number, rows: number) => void) | null = null;

  function drainPendingClientLogs(): void {
    for (const logBuf of pendingClientLogs) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(logBuf.subarray(1).toString('utf-8'));
      } catch {
        continue;
      }
      if (isClientLogMessage(parsed) && sessionLogger) {
        sessionLogger.clientLog(parsed.level, parsed.msg, parsed.seq, parsed.data);
      }
    }
    pendingClientLogs = [];
  }

  // Broadcast alerts from any session to this client
  const unsubAlert = registry.addAlertListener((alertSessionId: string) => {
    if (alertSessionId !== sessionId && ws.readyState === 1) {
      sendBinary(ws, SESSION_ALERT, alertSessionId);
    }
  });

  // Broadcast rich notifications from any session to this client
  const unsubNotification = registry.addNotificationListener((notifSessionId, title, body) => {
    if (notifSessionId !== sessionId && ws.readyState === 1) {
      const session = registry.getSession(notifSessionId);
      sendBinary(ws, SESSION_NOTIFICATION, JSON.stringify({
        sessionId: notifSessionId,
        title,
        body,
        sessionName: session?.info.name ?? '',
        sessionTitle: session?.info.title ?? '',
        sessionShell: session?.info.shell ?? '',
      }));
    }
  });

  function startSync(sid: string): void {
    const headless = registry.getHeadless(sid);
    if (!headless) return;

    // Send STATE_FULL immediately on attach
    const title = registry.getTitle(sid);
    const cursorHidden = registry.getCursorHidden(sid);
    const vtFull = serializeFullState(headless, title, cursorHidden);
    ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + vtFull));
    lastSnapshot = captureSnapshot(headless, title, cursorHidden);

    // --- Verification terminal (when MOBITTY_VERIFY_DIFF=1) ---
    let verifyTerm: InstanceType<typeof HeadlessTerminal> | null = null;
    let verifyFrameCount = 0;
    const VERIFY_INTERVAL = 30; // Compare every ~30 frames (~1s at 30fps)

    if (VERIFY_DIFF && sessionLogger) {
      verifyTerm = new HeadlessTerminal({
        cols: headless.cols,
        rows: headless.rows,
        scrollback: headless.options.scrollback ?? 5000,
        allowProposedApi: true,
      });
      verifyTerm.write('\x1b[3J' + vtFull);
      sessionLogger.debug('verify-diff: verification terminal created');
    }

    onSyncResize = (cols: number, rows: number) => {
      if (verifyTerm) verifyTerm.resize(cols, rows);
    };

    function runVerifyComparison(expectedSnapshot: FrameSnapshot): void {
      if (!verifyTerm || !sessionLogger) return;

      const verifySnapshot = captureSnapshot(verifyTerm, expectedSnapshot.title, expectedSnapshot.cursorHidden);
      const mismatches = compareSnapshots(expectedSnapshot, verifySnapshot, 20);

      if (mismatches.length > 0) {
        sessionLogger.warn('verify-diff: MISMATCH detected', {
          frameCount: verifyFrameCount,
          mismatchCount: mismatches.length,
          mismatches: mismatches.slice(0, 10).map(m => ({
            row: m.row, col: m.col, field: m.field,
            expected: m.expected, actual: m.actual,
          })),
        });

        // Self-heal: send STATE_FULL to client and reset verification terminal
        const h = registry.getHeadless(sid);
        if (h && ws.readyState === 1) {
          const t = registry.getTitle(sid);
          const ch = registry.getCursorHidden(sid);
          const healVt = serializeFullState(h, t, ch);
          ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + healVt));
          lastSnapshot = captureSnapshot(h, t, ch);
          verifyTerm.write('\x1b[3J' + healVt);
        }
      }
    }

    // Trailing-edge throttle: xterm events set dirty, flush runs at most every 33ms
    let dirty = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    const flush = () => {
      flushTimer = null;
      if (!dirty) return;
      dirty = false;

      if (ws.readyState !== 1) return; // Not OPEN — connection closing/closed

      const t = registry.getTitle(sid);
      const h = registry.getHeadless(sid);
      if (!h) { stopSync(); return; }

      const ch = registry.getCursorHidden(sid);
      const curr = captureSnapshot(h, t, ch);
      const prevSnapshot = lastSnapshot;

      let vtPayload = '';
      let wasFull = false;

      if (!prevSnapshot || curr.bufferType !== prevSnapshot.bufferType) {
        vtPayload = serializeFullState(h, t, ch);
        ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + vtPayload));
        wasFull = true;
      } else {
        const diff = generateDiff(prevSnapshot, curr);
        if (diff === null) {
          vtPayload = serializeFullState(h, t, ch);
          ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + vtPayload));
          wasFull = true;
        } else if (diff !== '') {
          vtPayload = diff;
          ws.send(Buffer.from(String.fromCharCode(STATE_UPDATE) + vtPayload));
        }
      }

      lastSnapshot = curr;

      // Frame statistics
      if (sessionLogger && vtPayload !== '') {
        const deltaScroll = prevSnapshot ? curr.baseY - prevSnapshot.baseY : 0;
        sessionLogger.debug('frame', { wasFull, deltaScroll, baseY: curr.baseY, diffBytes: vtPayload.length });
      }


      // Verification terminal
      if (verifyTerm && sessionLogger) {
        verifyFrameCount++;
        const shouldCompare = verifyFrameCount % VERIFY_INTERVAL === 0;

        if (wasFull) {
          verifyTerm.write('\x1b[3J' + vtPayload, () => {
            if (shouldCompare) runVerifyComparison(curr);
          });
        } else if (vtPayload !== '') {
          verifyTerm.write(vtPayload, () => {
            if (shouldCompare) runVerifyComparison(curr);
          });
        } else if (shouldCompare) {
          runVerifyComparison(curr);
        }
      }
    };

    const markDirty = () => {
      dirty = true;
      if (flushTimer === null) {
        flushTimer = setTimeout(flush, syncIntervalMs);
      }
    };

    registry.addChangeListener(sid, markDirty);

    syncCleanup = () => {
      registry.removeChangeListener(sid, markDirty);
      if (flushTimer !== null) { clearTimeout(flushTimer); flushTimer = null; }
      if (verifyTerm) { verifyTerm.dispose(); verifyTerm = null; }
    };
  }

  function stopSync(): void {
    if (syncCleanup) { syncCleanup(); syncCleanup = null; }
    lastSnapshot = null;
    onSyncResize = null;
  }

  // WebSocket heartbeat: detect dead connections within ~15s
  // Also measures RTT for auto refresh rate mode
  let lastPongAt = Date.now();
  let lastPingSentAt = 0;

  ws.on('pong', () => {
    lastPongAt = Date.now();
    if (lastPingSentAt > 0) {
      const rtt = lastPongAt - lastPingSentAt;
      const result = computeAutoInterval(rtt, smoothRtt, syncIntervalMs);
      smoothRtt = result.smoothRtt;
      if (result.syncIntervalMs !== syncIntervalMs) {
        syncIntervalMs = result.syncIntervalMs;
        logger.debug('adaptive refresh rate adjusted', { rtt, smoothRtt: Math.round(smoothRtt), fps: Math.round(1000 / syncIntervalMs) });
      }
      // Relay RTT + target FPS to client
      if (ws.readyState === 1) {
        const rttBuf = Buffer.allocUnsafe(4);
        rttBuf[0] = RTT_REPORT;
        rttBuf.writeUInt16BE(Math.min(Math.max(0, rtt), 65535), 1);
        rttBuf[3] = Math.round(1000 / syncIntervalMs);
        ws.send(rttBuf);
      }
    }
  });

  const heartbeatInterval = setInterval(() => {
    const elapsed = Date.now() - lastPongAt;
    if (elapsed > HEARTBEAT_TIMEOUT_MS) {
      logger.debug('heartbeat timeout, terminating connection', { address, elapsed });
      clearInterval(heartbeatInterval);
      ws.terminate();
      return;
    }
    if (ws.readyState === 1) {
      lastPingSentAt = Date.now();
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  ws.on('message', (rawData: Buffer | ArrayBuffer | Buffer[]) => {
    const buf = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData as ArrayBuffer);
    if (buf.length === 0) return;

    const command = buf[0];

    // JSON handshake (auth + session)
    if (command === JSON_DATA) {
      if (sessionId !== null) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.toString('utf-8'));
      } catch {
        logger.error('invalid JSON_DATA', { address });
        ws.close(1008, 'Invalid JSON');
        return;
      }

      if (!isAuthMessage(parsed)) {
        ws.close(1008, 'Invalid auth message');
        return;
      }

      const columns = typeof parsed.columns === 'number' ? parsed.columns : 80;
      const rows = typeof parsed.rows === 'number' ? parsed.rows : 24;
      const requestedSessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;

      // Parse scrollback preference
      const scrollback = typeof parsed.scrollback === 'number'
        && Number.isInteger(parsed.scrollback)
        && parsed.scrollback >= 100 && parsed.scrollback <= 50000
        ? parsed.scrollback : DEFAULT_SCROLLBACK;

      // Parse image paste directory
      if (typeof parsed.imagePasteDir === 'string' && parsed.imagePasteDir.length <= 256) {
        imagePasteDir = parsed.imagePasteDir;
      }

      // Parse notification mode → TERM_PROGRAM override
      const notificationModeEnv: Record<string, string> = {};
      if (parsed.notificationMode === 'iterm') {
        notificationModeEnv['TERM_PROGRAM'] = 'iTerm.app';
      } else if (parsed.notificationMode === 'kitty') {
        notificationModeEnv['TERM_PROGRAM'] = 'kitty';
      } else if (parsed.notificationMode === 'ghostty') {
        notificationModeEnv['TERM_PROGRAM'] = 'ghostty';
      }

      // Parse remote editor setting
      if (parsed.remoteEditor === true) {
        remoteEditor = true;
      }

      // Parse theme colors for OSC 10/11 color query responses
      const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
      if (typeof parsed.themeForeground === 'string' && HEX_COLOR.test(parsed.themeForeground)) {
        themeForeground = parsed.themeForeground;
      }
      if (typeof parsed.themeBackground === 'string' && HEX_COLOR.test(parsed.themeBackground)) {
        themeBackground = parsed.themeBackground;
      }

      // Remote editor env vars
      const editorEnv: Record<string, string> = {};
      if (remoteEditor && EDITOR_BIN_PATH) {
        editorEnv['EDITOR'] = EDITOR_BIN_PATH;
        editorEnv['VISUAL'] = EDITOR_BIN_PATH;
        editorEnv['MOBITTY_EDITOR_PORT'] = String(state.config.port);
        editorEnv['MOBITTY_EDITOR_HOST'] = state.config.host;
      }

      // Try to attach to existing session
      if (requestedSessionId) {
        const existing = registry.getSession(requestedSessionId);
        if (existing && existing.info.alive) {
          // Detach any previous connection (replaces it)
          registry.detachSession(requestedSessionId);

          const info = registry.attachSession(requestedSessionId, () => {
            ws.close(4002, 'Process exited');
          }, () => {
            if (ws.readyState === 1) ws.close(4003, 'Replaced');
          });
          if (info) {
            sessionId = requestedSessionId;
            sessionLogger = logger.createSessionLogger(sessionId);
            drainPendingClientLogs();
            registry.clearAlert(sessionId);
            registry.resizeSession(sessionId, columns, rows);
            registry.updateSessionScrollback(sessionId, scrollback);
            if (themeForeground && themeBackground) {
              registry.updateSessionThemeColors(sessionId, themeForeground, themeBackground);
            }

            sendBinary(ws, SET_WINDOW_TITLE, info.name);
            sendBinary(ws, SET_PREFERENCES, state.config.prefsJson);
            sendBinary(ws, SET_SESSION_INFO, JSON.stringify(info));

            // Reset snapshot so next tick sends STATE_FULL after resize
            lastSnapshot = null;
            startSync(sessionId);

            // Register editor sender and re-send pending edit if any
            registry.setEditorSender(sessionId, (filePath, content) => {
              sendBinary(ws, EDITOR_OPEN, JSON.stringify({ filePath, content }));
            });
            const pending = registry.getEditorPending(sessionId);
            if (pending) {
              sendBinary(ws, EDITOR_OPEN, JSON.stringify(pending));
            }

            lastPingSentAt = Date.now(); ws.ping();

            logger.debug('session attached', { address, sessionId, name: info.name });
            return;
          }
        } else if (existing && !existing.info.alive) {
          // Session exists but is dead
          sendBinary(ws, SET_SESSION_INFO, JSON.stringify(existing.info));
          ws.close(4002, 'Process exited');
          return;
        }
        // Session not found — tell the client
        ws.close(4004, 'Session not found');
        return;
      }

      // Create new session
      try {
        const shellName = typeof parsed.shell === 'string' ? parsed.shell : undefined;
        const shell = shellStore.resolve(shellName);
        if (!shell) {
          logger.error('no shells configured');
          ws.close(1011, 'No shells configured');
          return;
        }
        const { info } = registry.createSession(
          shell.argv,
          state.config.terminalType,
          columns,
          rows,
          scrollback,
          shell.name,
          { ...shell.env, ...notificationModeEnv, ...editorEnv },
        );
        sessionId = info.sessionId;
        sessionLogger = logger.createSessionLogger(sessionId);
        drainPendingClientLogs();
        registry.clearAlert(sessionId);
        if (themeForeground && themeBackground) {
          registry.updateSessionThemeColors(sessionId, themeForeground, themeBackground);
        }

        registry.attachSession(sessionId, () => {
          ws.close(4002, 'Process exited');
        }, () => {
          if (ws.readyState === 1) ws.close(4003, 'Replaced');
        });

        sendBinary(ws, SET_WINDOW_TITLE, info.name);
        sendBinary(ws, SET_PREFERENCES, state.config.prefsJson);
        sendBinary(ws, SET_SESSION_INFO, JSON.stringify(info));

        startSync(sessionId);

        // Register editor sender for newly created session
        registry.setEditorSender(sessionId, (filePath, content) => {
          sendBinary(ws, EDITOR_OPEN, JSON.stringify({ filePath, content }));
        });

        lastPingSentAt = Date.now(); ws.ping();

        logger.debug('session created and attached', { address, sessionId, name: info.name });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.error('session creation failed', { error: errMsg });
        ws.close(1011, 'Failed to spawn process');
      }
      return;
    }

    if (command === INPUT) {
      if (sessionId === null) return;
      if (buf.length < 2) return;
      const handle = registry.getHandle(sessionId);
      if (!handle) {
        sessionLogger?.warn('INPUT dropped: no pty handle', { sessionId });
        return;
      }
      const data = buf.subarray(1).toString('utf-8');
      writePty(handle, data);
      return;
    }

    if (command === RESIZE_TERMINAL) {
      if (sessionId === null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.subarray(1).toString('utf-8'));
      } catch {
        return;
      }
      if (isResizeMessage(parsed)) {
        registry.resizeSession(sessionId, parsed.columns, parsed.rows);
        onSyncResize?.(parsed.columns, parsed.rows);
        // Force STATE_FULL on next tick after headless resizes
        lastSnapshot = null;
      }
      return;
    }

    if (command === CLIPBOARD_IMAGE) {
      if (sessionId === null) return;
      const handle = registry.getHandle(sessionId);
      if (!handle) return;
      // [cmd:1][requestId:4][mimeLen:1][mime:N][imageData:M]
      if (buf.length < 7) return;
      const requestId = buf.readUInt32BE(1);
      const mimeLen = buf[5]!;
      if (buf.length < 6 + mimeLen) return;
      const mimeType = buf.subarray(6, 6 + mimeLen).toString('utf-8');
      const imageData = buf.subarray(6 + mimeLen);
      if (imageData.length === 0) {
        sendClipboardImageAck(ws, requestId, 1);
        return;
      }
      writeImageToSystemClipboard(imageData, mimeType).then(clipResult => {
        if (clipResult.success) {
          sendClipboardImageAck(ws, requestId, 0);
          return;
        }
        // System clipboard failed — fall back to file
        sessionLogger?.warn('system clipboard failed, trying file fallback', { error: clipResult.error });

        if (!imagePasteDir) {
          const errorJson = JSON.stringify({ clipboardError: clipResult.error });
          sessionLogger?.error('file fallback unavailable: imagePasteDir not configured');
          sendClipboardImageAck(ws, requestId, 1, errorJson);
          return;
        }

        const cwd = getProcessCwd(handle.pid);
        const dirPath = resolve(cwd, imagePasteDir);

        return writeImageToFile(imageData, mimeType, dirPath).then(fileResult => {
          if (fileResult.success && fileResult.filePath) {
            sessionLogger?.info('clipboard image saved to file', { path: fileResult.filePath });
            writePty(handle, fileResult.filePath);
            sendClipboardImageAck(ws, requestId, 2); // 2 = file fallback
          } else {
            const errorJson = JSON.stringify({
              clipboardError: clipResult.error,
              fileError: fileResult.error,
              imagePasteDir: dirPath,
            });
            sessionLogger?.error('clipboard image file write also failed', { error: fileResult.error });
            sendClipboardImageAck(ws, requestId, 1, errorJson);
          }
        });
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        sessionLogger?.error('clipboard image handler failed', { error: msg });
        sendClipboardImageAck(ws, requestId, 1, JSON.stringify({ clipboardError: msg }));
      });
      return;
    }

    if (command === UPDATE_SETTINGS) {
      if (sessionId === null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.subarray(1).toString('utf-8'));
      } catch {
        return;
      }
      if (!isUpdateSettingsMessage(parsed)) return;
      if (parsed.scrollback !== undefined) {
        registry.updateSessionScrollback(sessionId, parsed.scrollback);
      }
      if (parsed.imagePasteDir !== undefined) {
        imagePasteDir = parsed.imagePasteDir;
      }
      if (parsed.remoteEditor !== undefined) {
        remoteEditor = parsed.remoteEditor;
      }
      if (parsed.themeForeground !== undefined) {
        themeForeground = parsed.themeForeground;
      }
      if (parsed.themeBackground !== undefined) {
        themeBackground = parsed.themeBackground;
      }
      if (themeForeground && themeBackground) {
        registry.updateSessionThemeColors(sessionId, themeForeground, themeBackground);
      }
      return;
    }

    if (command === CLIENT_LOG) {
      if (sessionId === null || !sessionLogger) {
        if (pendingClientLogs.length < 100) pendingClientLogs.push(Buffer.from(buf));
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.subarray(1).toString('utf-8'));
      } catch {
        return;
      }
      if (isClientLogMessage(parsed)) {
        sessionLogger.clientLog(parsed.level, parsed.msg, parsed.seq, parsed.data);
      }
      return;
    }

    if (command === EDITOR_DONE) {
      if (sessionId === null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.subarray(1).toString('utf-8'));
      } catch {
        return;
      }
      if (typeof parsed !== 'object' || parsed === null) return;
      const r = parsed as Record<string, unknown>;
      if (typeof r['content'] !== 'string' || typeof r['cancelled'] !== 'boolean') return;
      registry.completeEdit(sessionId, r['content'], r['cancelled']);
      return;
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeatInterval);
    stopSync();
    unsubAlert();
    unsubNotification();
    if (sessionId !== null) {
      registry.clearEditorSender(sessionId);
    }
    state.clientCount--;
    logger.debug('WS closed', { address, clientCount: state.clientCount });

    // Clean up logger but do NOT call registry.detachSession() here.
    // stopSync() already removed this connection's change listener.
    // Calling detachSession() would race with a new connection that already
    // attached to the same session, wiping its freshly-registered callbacks.
    // The next connection's handshake calls detachSession() to clear stale
    // onExitCallbacks before attaching.
    if (sessionId !== null) {
      sessionLogger?.close();
      sessionLogger = null;
      sessionId = null;
    }
  });

  ws.on('error', (err) => {
    logger.error('WS error', { address, error: err.message });
  });
}
