import { useState, useRef, useEffect, useMemo, useCallback, lazy, Suspense } from 'react';
import { flushSync } from 'react-dom';
import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { XtermTerminal, type XtermTerminalHandle } from '@/components/XtermTerminal';
import { SoftkeyBar, type SoftkeyBarHandle } from '@/components/SoftkeyBar';
import { ContainerPanel } from '@/components/ContainerPanel';
import { BatchInputPanel } from '@/components/BatchInputPanel';
import { SessionPanel } from '@/components/SessionPanel';
import { SystemMeterPanel } from '@/components/SystemMeterPanel';
import { SystemMetrics } from '@/system-metrics';
import type { TerminalCoreOptions, TerminalCoreCallbacks, ImagePasteErrorInfo, ConnectionClosedReason } from '@/terminal-core';
import type { Profile, ProfileTheme } from '@/profiles';
import { fetchProfile, getCachedProfile, getSelectedProfileName, setSelectedProfileName, DEFAULT_SCROLLBACK, DEFAULT_DESKTOP_PROFILE, DEFAULT_MOBILE_PROFILE } from '@/profiles';
import { fetchTheme } from '@/themes';
import {
  DEFAULT_MOBILE_PAGES, DEFAULT_MOBILE_CUSTOM_KEYS, DEFAULT_MOBILE_CONTAINERS, DEFAULT_DESKTOP_PAGES,
  type SoftkeyCustomKeySpec, type SoftkeyContainerSpec, type KeySpec, type ModifierFlags,
  buildCustomKeyMap, buildContainerKeyMap, mergeKeyMaps, emptyModifiers,
  parseComboString, matchComboEvent,
} from '@/softkey-types';
import { DEFAULT_GESTURE_MAPPING } from '@/gesture-types';
import type { GestureMapping } from '@/gesture-types';
import { findFontOption, loadFont } from '@/fonts';
import { isNativeApp, getNativeBridge } from '@/native-bridge';
import { getLastSessionId, setLastSessionId, clearLastSessionId, fetchSessions, type SessionInfo } from '@/sessions';
import { fetchShells, type ShellInfo } from '@/shells';
import { openExternalUrl } from '@/open-external-url';
import { ShellSelectionPanel } from '@/components/ShellSelectionPanel';
import { RemoteEditorPanel } from '@/components/RemoteEditorPanel';
import { takeStaleRemoteEditorDrafts } from '@/remote-editor-storage';
import { pushEditorHistory } from '@/editor-history';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { ViewerFileCache } from '@/file-viewer/cache';
import type { ViewerFilePayload, ViewerOpenPayload } from '@/file-viewer/types';
import { basename } from '@/file-viewer/paths';
import { Eye } from 'lucide-react';

const SettingsDialog = lazy(() => import('@/components/SettingsDialog').then(m => ({ default: m.SettingsDialog })));
const ConnectionClosedDialog = lazy(() => import('@/components/ConnectionClosedDialog').then(m => ({ default: m.ConnectionClosedDialog })));
const ConnectionSlowOverlay = lazy(() => import('@/components/ConnectionSlowOverlay').then(m => ({ default: m.ConnectionSlowOverlay })));
const FileViewerPanel = lazy(() => import('@/components/FileViewerPanel'));
const ImagePasteErrorDialog = lazy(() => import('@/components/ImagePasteErrorDialog').then(m => ({ default: m.ImagePasteErrorDialog })));

/** A remote-editor draft untouched for this long is treated as abandoned and
 *  swept into the editor history ring. Comfortably longer than a reload or a
 *  reconnect, which is what the per-path draft exists to survive. */
const STALE_DRAFT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const defaultTheme: ITheme = {
  foreground: '#d2d2d2',
  background: '#2b2b2b',
  cursor: '#adadad',
  black: '#000000',
  red: '#d81e00',
  green: '#5ea702',
  yellow: '#cfae00',
  blue: '#427ab3',
  magenta: '#89658e',
  cyan: '#00a7aa',
  white: '#dbded8',
  brightBlack: '#686a66',
  brightRed: '#f54235',
  brightGreen: '#99e343',
  brightYellow: '#fdeb61',
  brightBlue: '#84b0d8',
  brightMagenta: '#bc94b7',
  brightCyan: '#37e6e8',
  brightWhite: '#f1f1f0',
};

const defaultTermOptions: ITerminalOptions = {
  fontSize: DEFAULT_DESKTOP_PROFILE.fontSize,
  fontFamily: DEFAULT_DESKTOP_PROFILE.fontFamily,
  theme: defaultTheme,
  scrollback: DEFAULT_SCROLLBACK,
  // mobitty owns scrolling (touch pan, momentum); xterm's scrollbar and
  // overview ruler are never shown.
  scrollbar: { showScrollbar: false },
  allowProposedApi: true,
  // Kitty keyboard protocol: once an app enables it (the server replays its
  // flags as `CSI = N ; 1 u`), Ctrl+Enter, Shift+Enter and friends get
  // unambiguous `CSI u` encodings. See docs/todo-bug-ctrl-enter-alt-buffer.md.
  vtExtensions: { kittyKeyboard: true },
  linkHandler: {
    activate(_event, text) {
      openExternalUrl(text);
    },
  },
};

function isTouchDevice(): boolean {
  return (navigator.maxTouchPoints > 0 || 'ontouchstart' in window) &&
    window.matchMedia('(hover: none) and (pointer: coarse)').matches;
}

function buildWsUrl(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const path = window.location.pathname.replace(/[/]+$/, '');
  return [protocol, '//', window.location.host, path, '/ws', window.location.search].join('');
}

export function App() {
  const [profile, setProfile] = useState<Profile | undefined>();
  const [profileReady, setProfileReady] = useState(false);
  const [themeColors, setThemeColors] = useState<ProfileTheme | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imagePasteError, setImagePasteError] = useState<ImagePasteErrorInfo | null>(null);
  const [connectionClosedReason, setConnectionClosedReason] = useState<ConnectionClosedReason | null>(null);
  const [connectingSlow, setConnectingSlow] = useState(false);
  const [batchInputOpen, setBatchInputOpen] = useState(false);
  const [batchInputFullscreen, setBatchInputFullscreen] = useState(false);
  // null = follow the profile setting. Set by the per-surface toggle buttons and
  // shared by all three text boxes, so flipping one flips them all.
  const [autocorrectOverride, setAutocorrectOverride] = useState<boolean | null>(null);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [isMobile] = useState(isTouchDevice);
  const [openContainerId, setOpenContainerId] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<ModifierFlags>(emptyModifiers());
  const [meterOpen, setMeterOpen] = useState(false);
  const [alertedSessionIds, setAlertedSessionIds] = useState<Set<string>>(() => new Set());
  // The session on screen rang its bell or sent a notification; cleared when
  // the user types into it or switches session.
  const [currentSessionAlerted, setCurrentSessionAlerted] = useState(false);
  const [pendingShellSelection, setPendingShellSelection] = useState<boolean>(() => getLastSessionId() === null);
  // When there's no stored session ID, we must check for alive sessions on the server before
  // showing the shell selection UI — otherwise we'd force shell selection even if sessions exist.
  const [initialCheckComplete, setInitialCheckComplete] = useState(() => getLastSessionId() !== null);
  const [initialShellName, setInitialShellName] = useState<string | undefined>();
  const [initialShells, setInitialShells] = useState<ShellInfo[]>([]);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editorFilePath, setEditorFilePath] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [editorContentType, setEditorContentType] = useState<string | undefined>();
  /** Server-assigned id of the edit the panel is showing, and a counter bumped
   *  on every EDITOR_OPEN received. The counter is what lets a *re-sent*
   *  EDITOR_OPEN (same edit id) produce a fresh ack. */
  const [editorEditId, setEditorEditId] = useState(0);
  const [editorOpenSeq, setEditorOpenSeq] = useState(0);
  /** Open and queued file views (`mobitty-cli view`), oldest first. Kept while
   *  hidden by a session switch; VIEWER_SYNC after the attach replay drops the
   *  ones the server no longer has. */
  const [views, setViews] = useState<ViewerOpenPayload[]>([]);
  const [activeViewId, setActiveViewId] = useState<number | null>(null);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerFilesVersion, setViewerFilesVersion] = useState(0);
  /** The user hid the viewer to see the terminal. A replayed VIEWER_OPEN
   *  (reconnect, session switch) leaves it hidden; a new view shows it. */
  const [viewerHidden, setViewerHidden] = useState(false);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);

  const refreshSessions = useCallback(async () => {
    const list = await fetchSessions();
    setSessions(list);
    return list;
  }, []);

  const terminalRef = useRef<XtermTerminalHandle>(null);
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  /** Mirrors `editorOpen` (as the open file's path, or null) so the
   *  session-switch effect can report what it closed without re-running. */
  const editorOpenRef = useRef<string | null>(null);
  /** Mirrors `views` / `activeViewId` for the terminal callbacks, which are
   *  created once. */
  const viewsRef = useRef<ViewerOpenPayload[]>([]);
  const activeViewIdRef = useRef<number | null>(null);
  const viewerCacheRef = useRef(new ViewerFileCache());
  /** `viewId\0path` keys with a VIEWER_REQUEST read outstanding, so re-renders
   *  don't re-send. */
  const viewerInFlightRef = useRef(new Set<string>());
  const metricsRef = useRef(new SystemMetrics());

  const setActiveView = useCallback((viewId: number | null) => {
    activeViewIdRef.current = viewId;
    setActiveViewId(viewId);
  }, []);

  const clearInFlight = useCallback((viewId: number) => {
    const prefix = `${viewId}\0`;
    for (const key of viewerInFlightRef.current) {
      if (key.startsWith(prefix)) viewerInFlightRef.current.delete(key);
    }
  }, []);

  /** Forget views and their files. A closed active view hands over to its
   *  neighbour in the tab strip. */
  const dropViews = useCallback((viewIds: ReadonlySet<number>) => {
    if (viewIds.size === 0) return;
    const before = viewsRef.current;
    for (const viewId of viewIds) {
      viewerCacheRef.current.clearView(viewId);
      clearInFlight(viewId);
    }
    const remaining = before.filter(v => !viewIds.has(v.viewId));
    viewsRef.current = remaining;
    setViews(remaining);
    const active = activeViewIdRef.current;
    if (active === null || viewIds.has(active)) {
      const at = before.findIndex(v => v.viewId === active);
      const next = remaining[Math.min(Math.max(at, 0), remaining.length - 1)];
      setActiveView(next?.viewId ?? null);
    }
    if (remaining.length === 0) setViewerOpen(false);
  }, [clearInFlight, setActiveView]);
  const softkeyBarRef = useRef<SoftkeyBarHandle>(null);

  // Keep ref in sync and clear alerts for newly-active session
  useEffect(() => {
    currentSessionIdRef.current = currentSessionId;
    if (currentSessionId) {
      setAlertedSessionIds(prev => {
        if (!prev.has(currentSessionId)) return prev;
        const next = new Set(prev);
        next.delete(currentSessionId);
        return next;
      });
    }
  }, [currentSessionId]);

  // Hide the remote editor on session switch. Server replays EDITOR_OPEN on
  // attach if the new session has a pending edit (protocol.ts: registerEditorSender).
  // Do NOT call sendEditorDone — server-side pending state must survive so
  // switching back replays the editor with the localStorage draft restored.
  useEffect(() => {
    if (editorOpenRef.current !== null) {
      terminalRef.current?.core?.clientLogger.info('editor panel hidden on session switch', {
        sessionId: currentSessionId ?? null,
        filePath: editorOpenRef.current,
      });
    }
    setEditorOpen(false);
    // Same for the file viewer: the server replays VIEWER_OPEN on attach.
    if (viewsRef.current.length > 0) {
      terminalRef.current?.core?.clientLogger.info('viewer panel hidden on session switch', {
        sessionId: currentSessionId ?? null,
        viewIds: viewsRef.current.map(v => v.viewId),
      });
    }
    setViewerOpen(false);
  }, [currentSessionId]);

  useEffect(() => { editorOpenRef.current = editorOpen ? editorFilePath : null; }, [editorOpen, editorFilePath]);

  /** Label for history entries captured in the active session. */
  const currentSessionLabel = useMemo(() => {
    const s = sessions.find(x => x.sessionId === currentSessionId);
    return s === undefined ? '' : (s.title || s.name);
  }, [sessions, currentSessionId]);

  // Collect abandoned editor drafts once per load. Claude Code's Ctrl+G uses a
  // fresh temp path per invocation, so a draft whose edit never reached Save or
  // Cancel strands a key nothing will read again. Moving it into the history
  // ring both bounds localStorage growth and keeps the content recoverable.
  useEffect(() => {
    for (const stale of takeStaleRemoteEditorDrafts(STALE_DRAFT_MAX_AGE_MS)) {
      pushEditorHistory({
        text: stale.text,
        fileName: stale.filePath.split(/[/\\]/).pop() ?? stale.filePath,
        sessionLabel: '',
        outcome: 'cancelled',
      });
    }
  }, []);

  // Preload lazy dialog chunks once the terminal handshake lands so that the
  // first open of Settings / Connection-Closed / Image-Paste-Error does not
  // stall on a chunk download.
  useEffect(() => {
    if (!currentSessionId) return;
    const run = () => {
      void import('@/components/SettingsDialog');
      void import('@/components/ConnectionClosedDialog');
      void import('@/components/ConnectionSlowOverlay');
      void import('@/components/ImagePasteErrorDialog');
      void import('@/components/FileViewerPanel');
    };
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(run);
    } else {
      setTimeout(run, 500);
    }
  }, [currentSessionId]);

  // On-demand diagnostic snapshot when the meter panel opens.
  useEffect(() => {
    if (meterOpen) terminalRef.current?.core?.logDiagnostics('meter-open');
  }, [meterOpen]);

  // Sync html/body height to visual viewport so the page never exceeds the
  // visible area.  Without this, the layout viewport stays full-screen when the
  // mobile keyboard opens, creating a scrollable region that blocks swipe-up
  // gestures and shows a scrollbar.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      const h = `${Math.round(vv.height)}px`;
      document.documentElement.style.height = h;
      document.body.style.height = h;
      // Reset any browser auto-scroll that happened when the keyboard opened
      window.scrollTo(0, 0);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, []);

  // Pre-fetch sessions on mount so the panel renders instantly when opened.
  // When there's no stored session ID, also use the result to decide between
  // shell selection vs. opening the session panel.
  useEffect(() => {
    refreshSessions()
      .then(list => {
        if (getLastSessionId() === null && list.some(s => s.alive)) {
          setPendingShellSelection(false);
          setSessionPanelOpen(true);
        }
      })
      .catch(() => { /* on error, fall through to shell selection */ })
      .finally(() => { setInitialCheckComplete(true); });
  }, [refreshSessions]);

  // iOS shell can ask us to open the session panel from a native gesture
  // (left-edge swipe, when enabled in iOS Settings). The shim's default is a
  // noop; we override it for the lifetime of this component.
  useEffect(() => {
    const bridge = getNativeBridge();
    if (!bridge) return;
    bridge.onOpenSessionListRequested = () => setSessionPanelOpen(true);
    return () => { bridge.onOpenSessionListRequested = () => {}; };
  }, []);

  // Fetch shells for new-user selection (waits for initial session check to avoid racing)
  useEffect(() => {
    if (!pendingShellSelection || !initialCheckComplete) return;
    fetchShells().then(shells => {
      if (shells.length <= 1) {
        setInitialShellName(shells[0]?.name);
        setPendingShellSelection(false);
      } else {
        setInitialShells(shells);
      }
    }).catch(() => {
      setPendingShellSelection(false);
    });
  }, [pendingShellSelection, initialCheckComplete]);

  // Load profile on mount (optimistic cache → background reconciliation)
  useEffect(() => {
    const device = isMobile ? 'mobile' : 'desktop';
    const name = getSelectedProfileName(device);
    const cached = getCachedProfile(name);
    const fallback = isMobile ? DEFAULT_MOBILE_PROFILE : DEFAULT_DESKTOP_PROFILE;

    const apply = async (p: Profile) => {
      const option = findFontOption(p.fontFamily);
      if (option) await loadFont(option);
      setProfile(p);
      setProfileReady(true);
    };

    if (cached) {
      // Use cache immediately, reconcile with server in background
      apply(cached).catch(() => { setProfile(cached); setProfileReady(true); });

      fetchProfile(name).then(async server => {
        if (!server) return;
        if (JSON.stringify(server) !== JSON.stringify(cached)) {
          const option = findFontOption(server.fontFamily);
          if (option) await loadFont(option);
          setProfile(server);
        }
      }).catch(() => {});
    } else {
      // No cache (first load or default profile): blocking fetch
      fetchProfile(name).then(async p => {
        if (!p) { setProfile(fallback); setProfileReady(true); return; }
        await apply(p);
      }).catch(() => { setProfile(fallback); setProfileReady(true); });
    }
  }, []);

  // Fetch theme colors based on OS color scheme.
  // Listens for OS light/dark changes to switch between the appropriate theme slot.
  useEffect(() => {
    if (!profile) return;

    const loadColors = () => {
      const isLight = window.matchMedia('(prefers-color-scheme: light)').matches;
      const themeName = isLight ? profile.themeLight : profile.themeDark;
      fetchTheme(themeName).then(theme => {
        if (theme) setThemeColors(theme.colors);
      }).catch(() => {});
    };

    loadColors();

    const mql = window.matchMedia('(prefers-color-scheme: light)');
    const handler = () => loadColors();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [profile?.themeLight, profile?.themeDark]);

  // Apply horizontal padding from profile
  useEffect(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const px = `${profile?.padding ?? 4}px`;
    root.style.paddingLeft = `max(${px}, env(safe-area-inset-left))`;
    root.style.paddingRight = `max(${px}, env(safe-area-inset-right))`;
  }, [profile?.padding]);

  // Session-panel hotkey: cross-platform; the modifier requirement below is what
  // keeps soft keyboards (which can't emit Ctrl/Alt/Shift) from triggering it.
  useEffect(() => {
    const hotkeyStr = profile?.sessionSwitcherHotkey ?? '';
    if (hotkeyStr === '') return;
    const combo = parseComboString(hotkeyStr);
    if (!combo) return;
    if (!combo.modifiers.ctrl && !combo.modifiers.alt && !combo.modifiers.shift) return;
    const handler = (e: KeyboardEvent) => {
      if (matchComboEvent(combo, e)) {
        e.preventDefault();
        e.stopPropagation();
        setSessionPanelOpen(prev => {
          if (prev) setTimeout(() => terminalRef.current?.core?.focus(), 0);
          return !prev;
        });
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [profile?.sessionSwitcherHotkey]);

  // Build terminal options (stable reference)
  const termOptions = useMemo((): TerminalCoreOptions => {
    return {
      wsUrl: buildWsUrl(),
      clientOptions: {
        rendererType: 'webgl',
  
        disableResizeOverlay: false,
        enableSixel: false,
        closeOnDisconnect: false,
        isWindows: false,
        unicodeVersion: '11',
      },
      termOptions: defaultTermOptions,
      sessionId: getLastSessionId() ?? undefined,
      shellName: initialShellName,
    };
    // Recompute when initialShellName becomes available (new-user shell selection)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialShellName]);

  // Derive softkey config from profile
  const softkeyConfig = useMemo((): { pages: string[][]; customKeys: SoftkeyCustomKeySpec[]; containers: SoftkeyContainerSpec[] } => {
    const sk = profile?.softkeys;
    if (sk) return { pages: sk.pages, customKeys: sk.customKeys, containers: sk.containers ?? [] };
    return {
      pages: isMobile ? DEFAULT_MOBILE_PAGES : DEFAULT_DESKTOP_PAGES,
      customKeys: isMobile ? DEFAULT_MOBILE_CUSTOM_KEYS : [],
      containers: isMobile ? DEFAULT_MOBILE_CONTAINERS : [],
    };
  }, [profile?.softkeys, isMobile]);

  const softkeySize = profile?.softkeySize ?? 44;

  // The single `?? true` read site for the profile field — absent on profiles
  // written before the setting existed, and the default is on.
  const autocorrectDefault = profile?.autocorrect ?? true;
  const autocorrect = autocorrectOverride ?? autocorrectDefault;

  // Toggling back to whatever the profile says drops the override entirely, so
  // a later settings change is authoritative again rather than shadowed by a
  // stale override that happens to agree with it.
  const handleAutocorrectToggle = useCallback(() => {
    setAutocorrectOverride(prev => {
      const next = !(prev ?? autocorrectDefault);
      return next === autocorrectDefault ? null : next;
    });
  }, [autocorrectDefault]);

  // Derive gesture mapping from profile
  const gestureMapping = useMemo((): GestureMapping => {
    return profile?.gestures ?? DEFAULT_GESTURE_MAPPING;
  }, [profile?.gestures]);

  // Build custom key map for gesture key resolution (includes container keys)
  const customKeyMap = useMemo(() => {
    const base = buildCustomKeyMap(softkeyConfig.customKeys);
    if (softkeyConfig.containers.length > 0) {
      return mergeKeyMaps(base, buildContainerKeyMap(softkeyConfig.containers));
    }
    return base;
  }, [softkeyConfig.customKeys, softkeyConfig.containers]);

  // Terminal callbacks
  const termCallbacks = useMemo((): TerminalCoreCallbacks => ({
    onSessionInfo: (info) => {
      setCurrentSessionId(info.sessionId);
      setLastSessionId(info.sessionId);
      refreshSessions().catch(() => {});
    },
    onSessionDied: (_sessionId) => {
      refreshSessions().catch(() => {});
    },
    onSessionNotFound: () => {
      clearLastSessionId();
      setCurrentSessionId(undefined);
      refreshSessions()
        .then((list) => {
          if (list.length > 0) {
            setSessionPanelOpen(true);
          } else {
            setInitialShellName(undefined);
            setPendingShellSelection(true);
          }
        })
        .catch(() => {
          setInitialShellName(undefined);
          setPendingShellSelection(true);
        });
    },
    onRttReport: (ms) => metricsRef.current.recordRtt(ms),
    onBytesSent: (n) => metricsRef.current.recordBytesOut(n),
    onBytesReceived: (n) => metricsRef.current.recordBytesIn(n),
    onTargetFps: (fps: number) => metricsRef.current.setTargetFps(fps),
    onSessionAlert: (alertSessionId: string) => {
      if (alertSessionId === currentSessionIdRef.current) return;
      setAlertedSessionIds(prev => {
        if (prev.has(alertSessionId)) return prev;
        const next = new Set(prev);
        next.add(alertSessionId);
        return next;
      });
    },
    onOwnAlertChange: (alerted: boolean) => setCurrentSessionAlerted(alerted),
    onSessionNotification: (notifSessionId: string, title: string, body: string, sessionName: string, sessionTitle: string, sessionCwd: string) => {
      if (notifSessionId === currentSessionIdRef.current) return;
      const sessionLabel = sessionTitle || sessionName;
      const toastTitle = sessionLabel ? `[${sessionLabel}] ${title}` : title;
      const description = [body, sessionCwd].filter(Boolean).join('\n') || undefined;
      toast(toastTitle, {
        description,
        duration: 5000,
        action: {
          label: 'Switch',
          onClick: () => {
            setLastSessionId(notifSessionId);
            setCurrentSessionId(notifSessionId);
            setAlertedSessionIds(prev => {
              if (!prev.has(notifSessionId)) return prev;
              const next = new Set(prev);
              next.delete(notifSessionId);
              return next;
            });
            setSessionPanelOpen(false);
            terminalRef.current?.core?.switchSession(notifSessionId);
          },
        },
      });
    },
    onImagePasteError: (error: ImagePasteErrorInfo) => {
      setImagePasteError(error);
    },
    onConnectionClosed: (reason: ConnectionClosedReason) => {
      setConnectionClosedReason(reason);
    },
    onConnectingSlow: () => setConnectingSlow(true),
    onConnected: () => setConnectingSlow(false),
    onEditorOpen: (editId: number, filePath: string, content: string, contentType?: string) => {
      const startedAt = performance.now();
      terminalRef.current?.core?.clientLogger.info('editor panel opening', {
        editId, filePath, bytes: content.length, contentType: contentType ?? null,
        visibility: document.visibilityState,
      });
      // Commit in *this* task rather than handing the work to React's scheduler.
      // A PTY process is blocked on this overlay, so the update is discrete by
      // nature — and the scheduler is exactly what failed: on 2026-09-16 a
      // WKWebView starved React's MessageChannel work loop for 12.2 s (no
      // commit, so no panel; no passive effect, so no ack) while setTimeout and
      // WebSocket delivery carried on normally. An unrelated tap released it.
      // See todo-bug-remote-editor-hangs-no-panel.md.
      flushSync(() => {
        setEditorEditId(editId);
        setEditorOpenSeq(seq => seq + 1);
        setEditorFilePath(filePath);
        setEditorContent(content);
        setEditorContentType(contentType);
        setEditorOpen(true);
      });
      terminalRef.current?.core?.clientLogger.info('editor panel committed', {
        editId, ms: Math.round(performance.now() - startedAt),
      });
    },
    onDownloadStart: (_fileName: string, _fileSize: number, token: string) => {
      const a = document.createElement('a');
      a.href = `/api/download/${token}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 100);
    },
    onViewerOpen: (view: ViewerOpenPayload) => {
      // A replay of a known view keeps its cache and selection; anything in
      // flight for it was sent on a socket that has since closed.
      clearInFlight(view.viewId);
      const known = viewsRef.current.some(v => v.viewId === view.viewId);
      const next = known
        ? viewsRef.current.map(v => (v.viewId === view.viewId ? view : v))
        : [...viewsRef.current, view];
      viewsRef.current = next;
      setViews(next);
      // A new view comes to the front, even over a hidden viewer.
      if (!known) {
        setActiveView(view.viewId);
        setViewerHidden(false);
      } else if (activeViewIdRef.current === null) {
        setActiveView(view.viewId);
      }
      setViewerOpen(true);
      setViewerFilesVersion(v => v + 1);
    },
    onViewerFile: (file: ViewerFilePayload) => {
      if (!viewsRef.current.some(v => v.viewId === file.viewId)) return;
      viewerInFlightRef.current.delete(`${file.viewId}\0${file.path}`);
      viewerCacheRef.current.set(file);
      setViewerFilesVersion(v => v + 1);
    },
    onViewerClose: (viewId: number) => {
      // Closed server-side (CLI gone, superseded) — nothing left to answer requests.
      dropViews(new Set([viewId]));
    },
    onViewerSync: (viewIds: number[]) => {
      const keep = new Set(viewIds);
      dropViews(new Set(viewsRef.current.filter(v => !keep.has(v.viewId)).map(v => v.viewId)));
    },
    onViewerNotice: (_viewId: number, message: string) => {
      toast(message);
    },
  }), [refreshSessions, clearInFlight, dropViews, setActiveView]);

  // Modifier source for the terminal
  const modifierSource = useMemo(() => {
    return {
      consumeModifiers: () => softkeyBarRef.current?.consumeModifiers() ?? { ctrl: false, alt: false, shift: false },
      clearModifiers: () => softkeyBarRef.current?.clearModifiers(),
      consumeModifierForTapSelection: (mod: 'alt' | 'shift') =>
        softkeyBarRef.current?.consumeModifierForTapSelection(mod) ?? false,
    };
  }, []);

  const handleApplyProfile = useCallback(async (p: Profile, device: 'desktop' | 'mobile') => {
    setSelectedProfileName(device, p.name);
    // Only update runtime if the applied profile is for the current device
    if ((device === 'mobile') === isMobile) {
      const option = findFontOption(p.fontFamily);
      if (option) await loadFont(option);
      setProfile(p);
      // An explicit save in settings restates the user's intent, so it wins over
      // a session toggle. Deliberately not done on the background profile
      // reconcile above, which replaces `profile` with no user action behind it.
      setAutocorrectOverride(null);
    }
  }, [isMobile]);


  const handleContainerToggle = useCallback((containerId: string) => {
    setOpenContainerId(prev => prev === containerId ? null : containerId);
  }, []);

  const handleContainerKeyPress = useCallback((keySpec: KeySpec) => {
    if (keySpec.behavior.kind === 'toggle-modifier') {
      softkeyBarRef.current?.toggleModifier(keySpec.behavior.modifier);
      return;
    }
    if (keySpec.behavior.kind === 'batch-input-toggle') {
      setBatchInputOpen(prev => !prev);
      return;
    }
    if (keySpec.behavior.kind === 'meter-toggle') {
      setMeterOpen(prev => !prev);
      return;
    }
    if (keySpec.behavior.kind === 'container-toggle') {
      handleContainerToggle(keySpec.behavior.containerId);
      return;
    }
    const mods = keySpec.consumesModifiers
      ? (softkeyBarRef.current?.consumeModifiers() ?? { ctrl: false, alt: false, shift: false })
      : { ctrl: false, alt: false, shift: false };
    terminalRef.current?.core?.handleSoftkeyAction(keySpec.behavior, mods);
  }, [handleContainerToggle]);

  const handleBatchSubmit = useCallback((text: string) => {
    terminalRef.current?.core?.handleBatchInput(text);
  }, []);

  const handlePaste = useCallback(() => {
    void terminalRef.current?.core?.handlePaste();
  }, []);

  const handleFileUpload = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.style.position = 'fixed';
    input.style.left = '-9999px';
    input.style.opacity = '0';
    input.style.pointerEvents = 'none';
    document.body.appendChild(input);

    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input);
    };
    input.addEventListener('cancel', cleanup, { once: true });
    input.addEventListener('change', () => {
      const files = input.files ? Array.from(input.files) : [];
      const core = terminalRef.current?.core;
      cleanup();
      if (!core || files.length === 0) {
        core?.focus();
        return;
      }
      void (async () => {
        for (const file of files) {
          try {
            const buffer = await file.arrayBuffer();
            await core.handleFileUpload(buffer, file.name);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            core.clientLogger.warn('file-upload-read-failed', { name: file.name, error: msg });
          }
        }
        core.focus();
      })();
    }, { once: true });
    input.click();
  }, []);

  const handleSwitchSession = useCallback((sessionId: string) => {
    setLastSessionId(sessionId);
    setCurrentSessionId(sessionId);
    setAlertedSessionIds(prev => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });
    terminalRef.current?.core?.switchSession(sessionId);
  }, []);

  const handleCreateSession = useCallback((shell?: string) => {
    clearLastSessionId();
    setCurrentSessionId(undefined);
    terminalRef.current?.core?.switchSession('', shell);
  }, []);

  const handleNoSessionsLeft = useCallback(() => {
    clearLastSessionId();
    setCurrentSessionId(undefined);
    setSessionPanelOpen(false);
    setInitialShellName(undefined);
    setPendingShellSelection(true);
  }, []);

  const handleInitialShellSelect = useCallback((name: string) => {
    setInitialShellName(name);
    setPendingShellSelection(false);
  }, []);

  const handleEditorOpened = useCallback((draftBytes: number) => {
    // `editorOpenSeq` is read, not just listed as a dep: this callback's
    // identity is what re-fires the panel's ack effect, so a re-sent
    // EDITOR_OPEN (same editId) must still produce a fresh one. As an unused
    // dep, lint autofix or the React Compiler's own dependency analysis would
    // drop it and silently un-ack every retry.
    void editorOpenSeq;
    if (editorEditId > 0) {
      // `draftBytes` is what the textarea actually renders, against the
      // `bytes` on `editor panel opening` — the two disagreeing is the
      // signature of a panel that is up but showing the wrong text.
      // See todo-bug-remote-editor-stale-content.md.
      terminalRef.current?.core?.clientLogger.info('editor draft loaded', {
        editId: editorEditId, draftBytes,
      });
      terminalRef.current?.core?.sendEditorAck(editorEditId);
    }
  }, [editorEditId, editorOpenSeq]);

  const handleEditorSave = useCallback((content: string) => {
    terminalRef.current?.core?.sendEditorDone(content, false, editorEditId);
    setEditorOpen(false);
    terminalRef.current?.core?.focus();
  }, [editorEditId]);

  const handleEditorCancel = useCallback(() => {
    // For images (view-only), send empty content to avoid a multi-MB round-trip
    const isImage = editorContentType?.startsWith('image/') ?? false;
    terminalRef.current?.core?.sendEditorDone(isImage ? '' : editorContent, true, editorEditId);
    setEditorOpen(false);
    terminalRef.current?.core?.focus();
  }, [editorContent, editorContentType, editorEditId]);

  const handleViewerRequestFile = useCallback((viewId: number, path: string) => {
    const key = `${viewId}\0${path}`;
    if (viewerInFlightRef.current.has(key)) return;
    if (terminalRef.current?.core?.sendViewerRequest(viewId, 'read', path)) {
      viewerInFlightRef.current.add(key);
    }
  }, []);

  const handleViewerEdit = useCallback((viewId: number, path: string) => {
    terminalRef.current?.core?.sendViewerRequest(viewId, 'edit', path);
  }, []);

  const handleViewerHide = useCallback(() => {
    setViewerHidden(true);
    terminalRef.current?.core?.focus();
  }, []);

  const handleViewerShow = useCallback(() => setViewerHidden(false), []);

  const handleViewerClose = useCallback((viewId: number) => {
    terminalRef.current?.core?.sendViewerDone(viewId);
    dropViews(new Set([viewId]));
    if (viewsRef.current.length === 0) terminalRef.current?.core?.focus();
  }, [dropViews]);

  const viewerTabs = useMemo(() => ({
    views,
    activeViewId: activeViewId ?? -1,
    onSelect: setActiveView,
  }), [views, activeViewId, setActiveView]);
  const activeView = views.find(v => v.viewId === activeViewId);

  const handleReconnect = useCallback(() => {
    setConnectionClosedReason(null);
    terminalRef.current?.core?.reconnect();
    terminalRef.current?.core?.focus();
  }, []);

  if (!profileReady || !profile) return null;

  return (
    <>
      {/* Terminal area — flex-1, always present for layout stability.
          Full-screen panels (editor, session list, shell picker, settings)
          mount here so their `absolute inset-0` is scoped to the terminal
          frame — below the safe-area band #root reserves via
          padding-top: env(safe-area-inset-top), above the softkey bar. */}
      <div className="flex-1 min-h-0 relative terminal-frame">
        {!pendingShellSelection && (
          <XtermTerminal
            ref={terminalRef}
            options={termOptions}
            profile={profile}
            themeColors={themeColors}
            modifierSource={modifierSource}
            callbacks={termCallbacks}
            gestureMapping={gestureMapping}
            customKeyMap={customKeyMap}
          />
        )}

        {/* Before the editor: both are `absolute inset-0 z-50`, so an edit
            opened from the viewer paints on top and reveals it on close. */}
        {views.length > 0 && (
          <Suspense fallback={null}>
            {views.map(view => (
              <FileViewerPanel
                key={view.viewId}
                open={viewerOpen && !viewerHidden && view.viewId === activeViewId}
                active={!editorOpen}
                view={view}
                files={viewerCacheRef.current}
                filesVersion={viewerFilesVersion}
                tabs={viewerTabs}
                onRequestFile={handleViewerRequestFile}
                onEdit={handleViewerEdit}
                onHide={handleViewerHide}
                onClose={handleViewerClose}
              />
            ))}
          </Suspense>
        )}
        {activeView && viewerOpen && viewerHidden && !editorOpen && (
          <button
            type="button"
            className="absolute top-2 right-2 z-40 max-w-[60%] flex items-center gap-1.5 rounded-full border border-border bg-[var(--bar-bg)] backdrop-blur-sm shadow-lg px-3 py-1.5 text-xs text-foreground"
            aria-label="Show viewer"
            title="Show viewer"
            onClick={handleViewerShow}
          >
            <Eye className="h-4 w-4 shrink-0" />
            <span className="truncate font-mono">{basename(activeView.initial ?? activeView.root)}</span>
            {views.length > 1 && <span className="shrink-0 text-muted-foreground">+{views.length - 1}</span>}
          </button>
        )}

        <RemoteEditorPanel
          open={editorOpen}
          filePath={editorFilePath}
          content={editorContent}
          contentType={editorContentType}
          sessionLabel={currentSessionLabel}
          autocorrect={autocorrect}
          onAutocorrectToggle={handleAutocorrectToggle}
          onOpened={handleEditorOpened}
          onSave={handleEditorSave}
          onCancel={handleEditorCancel}
        />

        <RemoteEditorPanel
          open={batchInputFullscreen}
          mode="fullscreen-input"
          autocorrect={autocorrect}
          onAutocorrectToggle={handleAutocorrectToggle}
          onSave={() => setBatchInputFullscreen(false)}
          onCancel={() => setBatchInputFullscreen(false)}
        />

        {pendingShellSelection && initialShells.length > 0 && (
          <ShellSelectionPanel shells={initialShells} onSelect={handleInitialShellSelect} />
        )}

        <SessionPanel
          open={sessionPanelOpen}
          onClose={() => { setSessionPanelOpen(false); terminalRef.current?.core?.focus(); }}
          sessions={sessions}
          onRefreshSessions={refreshSessions}
          currentSessionId={currentSessionId}
          alertedSessionIds={alertedSessionIds}
          currentSessionAlerted={currentSessionAlerted}
          onSwitchSession={handleSwitchSession}
          onCreateSession={handleCreateSession}
          onSettingsOpen={() => setSettingsOpen(true)}
          onNoSessionsLeft={handleNoSessionsLeft}
          isMobile={isMobile}
        />

        {settingsOpen && (
          <Suspense fallback={null}>
            <SettingsDialog
              open={settingsOpen}
              onOpenChange={setSettingsOpen}
              currentProfile={profile}
              isMobile={isMobile}
              onApply={handleApplyProfile}
            />
          </Suspense>
        )}
      </div>

      {/* Bottom panels — normal flow flex items (top to bottom = visual bottom to top) */}
      <BatchInputPanel
        open={batchInputOpen}
        fullscreen={batchInputFullscreen}
        autocorrect={autocorrect}
        onAutocorrectToggle={handleAutocorrectToggle}
        onSubmit={handleBatchSubmit}
        onClose={() => { setBatchInputOpen(false); terminalRef.current?.core?.focus(); }}
        onFullscreenToggle={() => setBatchInputFullscreen(true)}
      />

      <ContainerPanel
        containerId={openContainerId}
        containerSpecs={softkeyConfig.containers}
        customKeyMap={customKeyMap}
        softkeySize={softkeySize}
        modifiers={modifiers}
        onKeyPress={handleContainerKeyPress}
        onKeepFocus={() => terminalRef.current?.core?.focus()}
      />

      {(!(profile?.hideSoftkeyBar && (profile.sessionSwitcherHotkey ?? '').trim() !== '') || sessionPanelOpen || settingsOpen) && (
        <SoftkeyBar
          ref={softkeyBarRef}
          pages={softkeyConfig.pages}
          customKeys={softkeyConfig.customKeys}
          containers={softkeyConfig.containers}
          activeContainerId={openContainerId}
          batchInputOpen={batchInputOpen}
          softkeySize={softkeySize}
          hasAlerts={alertedSessionIds.size > 0 || currentSessionAlerted}
          isMobile={isMobile}
          isNativeApp={isNativeApp()}
          autocorrect={autocorrect}
          onAutocorrectToggle={handleAutocorrectToggle}
          onSessionsOpen={() => setSessionPanelOpen(true)}
          onMeterToggle={() => setMeterOpen(prev => !prev)}
          onAction={(action, mods) => terminalRef.current?.core?.handleSoftkeyAction(action, mods)}
          onPaste={handlePaste}
          onFileUpload={handleFileUpload}
          onBatchInputToggle={() => setBatchInputOpen(prev => !prev)}
          onBatchSubmit={handleBatchSubmit}
          onContainerToggle={handleContainerToggle}
          onKeepFocus={() => terminalRef.current?.core?.focus()}
          onModifiersChange={setModifiers}
        />
      )}


      <SystemMeterPanel
        open={meterOpen}
        metrics={metricsRef.current}
        onClose={() => setMeterOpen(false)}
        getTerminalDiagnostics={() => terminalRef.current?.core?.getDiagnostics()}
      />

      {imagePasteError !== null && (
        <Suspense fallback={null}>
          <ImagePasteErrorDialog
            error={imagePasteError}
            onClose={() => setImagePasteError(null)}
          />
        </Suspense>
      )}

      {connectionClosedReason !== null && (
        <Suspense fallback={null}>
          <ConnectionClosedDialog
            reason={connectionClosedReason}
            onReconnect={handleReconnect}
          />
        </Suspense>
      )}

      {connectingSlow && connectionClosedReason === null && (
        <Suspense fallback={null}>
          <ConnectionSlowOverlay open={connectingSlow} />
        </Suspense>
      )}

      {/* Notification toasts */}
      <Toaster />
    </>
  );
}
