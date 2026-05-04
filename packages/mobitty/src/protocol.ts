import type { WebSocket } from 'ws';
import type { IncomingMessage } from 'node:http';
import {
  SET_WINDOW_TITLE, SET_PREFERENCES, SET_SESSION_INFO,
  STATE_UPDATE, STATE_FULL,
  INPUT, RESIZE_TERMINAL, UPDATE_SETTINGS, JSON_DATA, CLIENT_LOG,
  CLIPBOARD_IMAGE, CLIPBOARD_IMAGE_ACK, RTT_REPORT, SESSION_ALERT, SESSION_NOTIFICATION,
  EDITOR_OPEN, EDITOR_DONE, DOWNLOAD_START,
  HEARTBEAT_INTERVAL_MS, HEARTBEAT_TIMEOUT_MS,
  isResizeMessage, isHandshakeMessage, isUpdateSettingsMessage,
  isClientLogBatch,
} from './types.ts';
import type { ServerState } from './types.ts';
const DEFAULT_SCROLLBACK = 5000;
import { resolve, relative, isAbsolute } from 'node:path';
import { writePty } from './pty.ts';
import { writeImageToSystemClipboard, writeImageToFile, getProcessCwd } from './clipboard.ts';
import type { SessionRegistry } from './sessions.ts';
import type { ShellStore } from './shells.ts';
import type { Logger } from './logger.ts';
import { captureSnapshot, generateDiff, serializeFullState, compareSnapshots, bufferStats, summarizeBytes } from './diff.ts';
import type { FrameSnapshot } from './diff.ts';
import { resolveCliBin, ensureCliBinShim } from './cli-bin.ts';

import headlessPkg from '@xterm/headless';
const { Terminal: HeadlessTerminal } = headlessPkg;

const VERIFY_DIFF = process.env['MOBITTY_VERIFY_DIFF'] === '1';
const CLI_BIN_PATH = resolveCliBin('mobitty-cli');
const CLI_EDIT_BIN_PATH = resolveCliBin('mobitty-cli-edit');

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
  const socketLogger = logger.child({ address });

  if (state.config.maxConnections > 0 && state.clientCount >= state.config.maxConnections) {
    socketLogger.warn('connection limit reached', { clientCount: state.clientCount, maxConnections: state.config.maxConnections });
    ws.close(1013, 'Connection limit reached');
    return;
  }

  state.clientCount++;
  socketLogger.info('WS connected', { clientCount: state.clientCount });

  let syncIntervalMs = 33; // adaptive; adjusted continuously by RTT
  let smoothRtt = 33;      // EMA of RTT for adaptive sync interval
  let imagePasteDir: string | undefined;
  let remoteEditor = false;
  let themeForeground: string | undefined;
  let themeBackground: string | undefined;

  let sessionId: string | null = null;
  let lastSnapshot: FrameSnapshot | null = null;
  let syncCleanup: (() => void) | null = null;
  let onSyncResize: ((cols: number, rows: number) => void) | null = null;

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
        sessionCwd: session?.info.cwd ?? '',
      }));
    }
  });

  function startSync(sid: string): void {
    const headless = registry.getHeadless(sid);
    const serializer = registry.getSerializeAddon(sid);
    if (!headless || !serializer) return;

    // Send STATE_FULL immediately on attach
    const title = registry.getTitle(sid);
    const cursorHidden = registry.getCursorHidden(sid);
    const vtFull = serializeFullState(serializer, title, cursorHidden);
    socketLogger.info('state-full sent', { stats: bufferStats(headless), payload: summarizeBytes(vtFull, 200) });
    ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + vtFull));
    lastSnapshot = captureSnapshot(headless, title, cursorHidden, registry.getScrollCount(sid));

    // --- Verification terminal (when MOBITTY_VERIFY_DIFF=1) ---
    let verifyTerm: InstanceType<typeof HeadlessTerminal> | null = null;
    let verifyFrameCount = 0;
    const VERIFY_INTERVAL = 30; // Compare every ~30 frames (~1s at 30fps)

    if (VERIFY_DIFF && socketLogger) {
      verifyTerm = new HeadlessTerminal({
        cols: headless.cols,
        rows: headless.rows,
        scrollback: headless.options.scrollback ?? 5000,
        allowProposedApi: true,
      });
      verifyTerm.write('\x1b[3J' + vtFull);
      socketLogger.debug('verify-diff: verification terminal created');
    }

    onSyncResize = (cols: number, rows: number) => {
      if (verifyTerm) verifyTerm.resize(cols, rows);
    };

    function runVerifyComparison(expectedSnapshot: FrameSnapshot): void {
      if (!verifyTerm || !socketLogger) return;

      const verifySnapshot = captureSnapshot(verifyTerm, expectedSnapshot.title, expectedSnapshot.cursorHidden, 0);
      const mismatches = compareSnapshots(expectedSnapshot, verifySnapshot, 20);

      if (mismatches.length > 0) {
        socketLogger.warn('verify-diff: MISMATCH detected', {
          frameCount: verifyFrameCount,
          mismatchCount: mismatches.length,
          mismatches: mismatches.slice(0, 10).map(m => ({
            row: m.row, col: m.col, field: m.field,
            expected: m.expected, actual: m.actual,
          })),
        });

        // Self-heal: send STATE_FULL to client and reset verification terminal
        const h = registry.getHeadless(sid);
        const ser = registry.getSerializeAddon(sid);
        if (h && ser && ws.readyState === 1) {
          const t = registry.getTitle(sid);
          const ch = registry.getCursorHidden(sid);
          const healVt = serializeFullState(ser, t, ch);
          ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + healVt));
          lastSnapshot = captureSnapshot(h, t, ch, registry.getScrollCount(sid));
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
      const ser = registry.getSerializeAddon(sid);
      if (!h || !ser) { stopSync(); return; }

      const ch = registry.getCursorHidden(sid);
      const curr = captureSnapshot(h, t, ch, registry.getScrollCount(sid));
      const prevSnapshot = lastSnapshot;

      let vtPayload = '';
      let wasFull = false;

      if (!prevSnapshot || curr.bufferType !== prevSnapshot.bufferType) {
        vtPayload = serializeFullState(ser, t, ch);
        ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + vtPayload));
        wasFull = true;
      } else {
        const diff = generateDiff(prevSnapshot, curr);
        if (diff === null) {
          vtPayload = serializeFullState(ser, t, ch);
          ws.send(Buffer.from(String.fromCharCode(STATE_FULL) + vtPayload));
          wasFull = true;
        } else if (diff !== '') {
          vtPayload = diff;
          ws.send(Buffer.from(String.fromCharCode(STATE_UPDATE) + vtPayload));
        }
      }

      lastSnapshot = curr;

      // Frame statistics
      if (socketLogger.isEnabled('debug') && vtPayload !== '') {
        const scrollDelta = prevSnapshot ? curr.scrollCount - prevSnapshot.scrollCount : 0;
        socketLogger.debug('frame', {
          wasFull,
          scrollDelta,
          baseY: curr.baseY,
          diffBytes: vtPayload.length,
          stats: bufferStats(h),
          payload: summarizeBytes(vtPayload, 200),
        });
      }


      // Verification terminal
      if (verifyTerm && socketLogger) {
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
        socketLogger.debug('adaptive refresh rate adjusted', { rtt, smoothRtt: Math.round(smoothRtt), fps: Math.round(1000 / syncIntervalMs) });
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
      socketLogger.warn('heartbeat timeout, terminating connection', { elapsed });
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
        socketLogger.error('invalid JSON_DATA');
        ws.close(1008, 'Invalid JSON');
        return;
      }

      if (!isHandshakeMessage(parsed)) {
        socketLogger.warn('invalid handshake message');
        ws.close(1008, 'Invalid handshake');
        return;
      }

      const columns = typeof parsed.columns === 'number'
        && Number.isInteger(parsed.columns)
        && parsed.columns >= 1 && parsed.columns <= 800
        ? parsed.columns : 80;
      const rows = typeof parsed.rows === 'number'
        && Number.isInteger(parsed.rows)
        && parsed.rows >= 1 && parsed.rows <= 400
        ? parsed.rows : 24;
      const requestedSessionId = typeof parsed.sessionId === 'string' ? parsed.sessionId : undefined;

      // Parse scrollback preference
      const scrollback = typeof parsed.scrollback === 'number'
        && Number.isInteger(parsed.scrollback)
        && parsed.scrollback >= 100 && parsed.scrollback <= 50000
        ? parsed.scrollback : DEFAULT_SCROLLBACK;

      // Parse image paste directory
      if (typeof parsed.imagePasteDir === 'string' && parsed.imagePasteDir.length <= 256
          && !isAbsolute(parsed.imagePasteDir)) {
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

      // Parse remote editor setting.
      // If no EDITOR is set in the environment, always enable the remote
      // editor so the user has *some* editor available inside the PTY.
      if (parsed.remoteEditor === true || !process.env['EDITOR']) {
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

      // CLI env vars (shared by editor, download, view subcommands)
      const cliEnv: Record<string, string> = {};
      const cliBinPath = CLI_BIN_PATH
        ? ensureCliBinShim(CLI_BIN_PATH, state.config.dataFolder, 'mobitty-cli')
        : null;
      if (cliBinPath) {
        cliEnv['MOBITTY_CLI_PORT'] = String(state.config.port);
        cliEnv['MOBITTY_CLI_HOST'] = state.config.host;
        if (state.config.tls) {
          cliEnv['MOBITTY_CLI_TLS'] = '1';
        }
        if (remoteEditor && CLI_EDIT_BIN_PATH) {
          // Use the dedicated mobitty-cli-edit bin (no " edit" suffix) so
          // consumers that don't word-split $EDITOR — e.g. GitHub Copilot's
          // terminal — can exec the value as a single binary path.
          const cliEditBinPath = ensureCliBinShim(CLI_EDIT_BIN_PATH, state.config.dataFolder, 'mobitty-cli-edit');
          cliEnv['EDITOR'] = cliEditBinPath;
          cliEnv['VISUAL'] = cliEditBinPath;
        }
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
            socketLogger.set('session', sessionId);
            registry.clearAlert(sessionId);
            const headlessBeforeResize = registry.getHeadless(sessionId);
            socketLogger.info('reconnect: pre-resize', {
              clientCols: columns,
              clientRows: rows,
              before: headlessBeforeResize ? bufferStats(headlessBeforeResize) : null,
            });
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
            registry.setEditorSender(sessionId, (filePath, content, contentType) => {
              const payload: Record<string, string> = { filePath, content };
              if (contentType) payload['contentType'] = contentType;
              sendBinary(ws, EDITOR_OPEN, JSON.stringify(payload));
            });
            const pending = registry.getEditorPending(sessionId);
            if (pending) {
              sendBinary(ws, EDITOR_OPEN, JSON.stringify(pending));
            }

            // Register download sender
            registry.setDownloadSender(sessionId, (fileName, fileSize, token) => {
              sendBinary(ws, DOWNLOAD_START, JSON.stringify({ fileName, fileSize, token }));
            });

            lastPingSentAt = Date.now(); ws.ping();

            socketLogger.info('session attached', { name: info.name });
            return;
          }
        } else if (existing && !existing.info.alive) {
          // Session exists but is dead
          socketLogger.info('session dead, closing connection', { sessionId: requestedSessionId });
          sendBinary(ws, SET_SESSION_INFO, JSON.stringify(existing.info));
          ws.close(4002, 'Process exited');
          return;
        }
        // Session not found — tell the client
        socketLogger.info('session not found, closing connection', { sessionId: requestedSessionId });
        ws.close(4004, 'Session not found');
        return;
      }

      // Create new session
      try {
        const shellName = typeof parsed.shell === 'string' ? parsed.shell : undefined;
        const shell = shellStore.resolve(shellName);
        if (!shell) {
          socketLogger.error('no shells configured');
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
          { ...shell.env, ...notificationModeEnv, ...cliEnv },
        );
        sessionId = info.sessionId;
        socketLogger.set('session', sessionId);
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
        registry.setEditorSender(sessionId, (filePath, content, contentType) => {
          const payload: Record<string, string> = { filePath, content };
          if (contentType) payload['contentType'] = contentType;
          sendBinary(ws, EDITOR_OPEN, JSON.stringify(payload));
        });

        // Register download sender for newly created session
        registry.setDownloadSender(sessionId, (fileName, fileSize, token) => {
          sendBinary(ws, DOWNLOAD_START, JSON.stringify({ fileName, fileSize, token }));
        });

        lastPingSentAt = Date.now(); ws.ping();

        socketLogger.info('session created and attached', { name: info.name });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        if (errMsg === 'Session limit reached') {
          socketLogger.warn('session limit reached', { maxSessions: state.config.maxSessions });
          ws.close(1013, 'Session limit reached');
        } else {
          socketLogger.error('session creation failed', { error: errMsg });
          ws.close(1011, 'Failed to spawn process');
        }
      }
      return;
    }

    if (command === INPUT) {
      if (sessionId === null) return;
      if (buf.length < 2) return;
      const handle = registry.getHandle(sessionId);
      if (!handle) {
        socketLogger.warn('INPUT dropped: no pty handle', { sessionId });
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
        socketLogger.debug('RESIZE_TERMINAL parse failed');
        return;
      }
      if (isResizeMessage(parsed)) {
        socketLogger.info('client resize', { cols: parsed.columns, rows: parsed.rows });
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
        socketLogger.warn('system clipboard failed, trying file fallback', { error: clipResult.error });

        if (!imagePasteDir) {
          const errorJson = JSON.stringify({ clipboardError: clipResult.error });
          socketLogger.error('file fallback unavailable: imagePasteDir not configured');
          sendClipboardImageAck(ws, requestId, 1, errorJson);
          return;
        }

        const cwd = getProcessCwd(handle.pid);
        const dirPath = resolve(cwd, imagePasteDir);
        const rel = relative(cwd, dirPath);
        if (rel.startsWith('..') || isAbsolute(rel)) {
          socketLogger.warn('imagePasteDir escapes cwd, rejecting', { cwd, imagePasteDir, resolved: dirPath });
          sendClipboardImageAck(ws, requestId, 1, JSON.stringify({
            clipboardError: clipResult.error,
            containmentError: 'imagePasteDir resolves outside working directory',
          }));
          return;
        }

        return writeImageToFile(imageData, mimeType, dirPath).then(fileResult => {
          if (fileResult.success && fileResult.filePath) {
            socketLogger.info('clipboard image saved to file', { path: fileResult.filePath });
            writePty(handle, fileResult.filePath);
            sendClipboardImageAck(ws, requestId, 2); // 2 = file fallback
          } else {
            const errorJson = JSON.stringify({
              clipboardError: clipResult.error,
              fileError: fileResult.error,
              imagePasteDir: dirPath,
            });
            socketLogger.error('clipboard image file write also failed', { error: fileResult.error });
            sendClipboardImageAck(ws, requestId, 1, errorJson);
          }
        });
      }).catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        socketLogger.error('clipboard image handler failed', { error: msg });
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
        socketLogger.debug('UPDATE_SETTINGS parse failed');
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
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.subarray(1).toString('utf-8'));
      } catch {
        socketLogger.debug('CLIENT_LOG parse failed');
        return;
      }
      if (isClientLogBatch(parsed)) {
        for (const entry of parsed) {
          socketLogger.clientLog(entry.level, entry.msg, entry.seq, entry.data, entry.ts);
        }
      }
      return;
    }

    if (command === EDITOR_DONE) {
      if (sessionId === null) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(buf.subarray(1).toString('utf-8'));
      } catch {
        socketLogger.debug('EDITOR_DONE parse failed');
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
      registry.clearDownloadSender(sessionId);
    }
    state.clientCount--;
    socketLogger.info('WS closed', { clientCount: state.clientCount });

    // Do NOT call registry.detachSession() here.
    // stopSync() already removed this connection's change listener.
    // Calling detachSession() would race with a new connection that already
    // attached to the same session, wiping its freshly-registered callbacks.
    // The next connection's handshake calls detachSession() to clear stale
    // onExitCallbacks before attaching.
    sessionId = null;
  });

  ws.on('error', (err) => {
    socketLogger.error('WS error', { error: err.message });
  });
}
