import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import type { ITerminalOptions, ITheme } from '@xterm/xterm';
import { XtermTerminal, type XtermTerminalHandle } from '@/components/XtermTerminal';
import { SoftkeyBar, type SoftkeyBarHandle } from '@/components/SoftkeyBar';
import { ContainerPanel } from '@/components/ContainerPanel';
import { BatchInputPanel } from '@/components/BatchInputPanel';
import { SettingsDialog } from '@/components/SettingsDialog';
import { ImagePasteErrorDialog } from '@/components/ImagePasteErrorDialog';
import { ConnectionClosedDialog } from '@/components/ConnectionClosedDialog';
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
import { getLastSessionId, setLastSessionId, clearLastSessionId, fetchSessions } from '@/sessions';
import { fetchShells, type ShellInfo } from '@/shells';
import { ShellSelectionPanel } from '@/components/ShellSelectionPanel';
import { RemoteEditorPanel } from '@/components/RemoteEditorPanel';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';

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
  allowProposedApi: true,
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

function buildTokenUrl(): string {
  const path = window.location.pathname.replace(/[/]+$/, '');
  return [window.location.protocol, '//', window.location.host, path, '/token'].join('');
}

const DEFAULT_SOFTKEY_SIZE = 44;
const DEFAULT_SESSION_SWITCHER_HOTKEY = 'Ctrl+Shift+s';

export function App() {
  const [profile, setProfile] = useState<Profile | undefined>();
  const [profileReady, setProfileReady] = useState(false);
  const [themeColors, setThemeColors] = useState<ProfileTheme | undefined>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [imagePasteError, setImagePasteError] = useState<ImagePasteErrorInfo | null>(null);
  const [connectionClosedReason, setConnectionClosedReason] = useState<ConnectionClosedReason | null>(null);
  const [batchInputOpen, setBatchInputOpen] = useState(false);
  const [sessionPanelOpen, setSessionPanelOpen] = useState(false);
  const [currentSessionId, setCurrentSessionId] = useState<string | undefined>();
  const [isMobile] = useState(isTouchDevice);
  const [openContainerId, setOpenContainerId] = useState<string | null>(null);
  const [modifiers, setModifiers] = useState<ModifierFlags>(emptyModifiers());
  const [meterOpen, setMeterOpen] = useState(false);
  const [alertedSessionIds, setAlertedSessionIds] = useState<Set<string>>(() => new Set());
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

  const terminalRef = useRef<XtermTerminalHandle>(null);
  const currentSessionIdRef = useRef<string | undefined>(undefined);
  const metricsRef = useRef(new SystemMetrics());
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

  // On mount with no stored session ID, check for alive sessions before showing shell selection.
  // If alive sessions exist, open the session panel instead.
  useEffect(() => {
    if (getLastSessionId() !== null) return;
    fetchSessions()
      .then(sessions => {
        if (sessions.some(s => s.alive)) {
          setPendingShellSelection(false);
          setSessionPanelOpen(true);
        }
      })
      .catch(() => { /* on error, fall through to shell selection */ })
      .finally(() => { setInitialCheckComplete(true); });
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

  // Cleanup metrics on unmount
  useEffect(() => {
    const m = metricsRef.current;
    return () => m.dispose();
  }, []);

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
    root.style.paddingLeft = px;
    root.style.paddingRight = px;
  }, [profile?.padding]);

  // Desktop-only hotkey to toggle session panel
  useEffect(() => {
    if (isMobile) return;
    const hotkeyStr = profile?.sessionSwitcherHotkey ?? DEFAULT_SESSION_SWITCHER_HOTKEY;
    if (hotkeyStr === '') return;
    const combo = parseComboString(hotkeyStr);
    if (!combo) return;
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
  }, [isMobile, profile?.sessionSwitcherHotkey]);

  // Build terminal options (stable reference)
  const termOptions = useMemo((): TerminalCoreOptions => {
    return {
      wsUrl: buildWsUrl(),
      tokenUrl: buildTokenUrl(),
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
    if (sk) {
      return { pages: sk.pages, customKeys: sk.customKeys, containers: sk.containers ?? [] };
    }
    return {
      pages: isMobile ? DEFAULT_MOBILE_PAGES : DEFAULT_DESKTOP_PAGES,
      customKeys: isMobile ? DEFAULT_MOBILE_CUSTOM_KEYS : [],
      containers: isMobile ? DEFAULT_MOBILE_CONTAINERS : [],
    };
  }, [profile?.softkeys, isMobile]);

  const softkeySize = profile?.softkeySize ?? DEFAULT_SOFTKEY_SIZE;

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
    },
    onSessionDied: (_sessionId) => {
      // Session died — user can open session panel to see it
    },
    onSessionNotFound: () => {
      clearLastSessionId();
      setCurrentSessionId(undefined);
      fetchSessions()
        .then((sessions) => {
          if (sessions.length > 0) {
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
    onSessionNotification: (notifSessionId: string, title: string, body: string, sessionName: string, sessionTitle: string) => {
      if (notifSessionId === currentSessionIdRef.current) return;
      const sessionLabel = sessionTitle || sessionName;
      const toastTitle = sessionLabel ? `[${sessionLabel}] ${title}` : title;
      toast(toastTitle, {
        description: body || undefined,
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
    onEditorOpen: (filePath: string, content: string, contentType?: string) => {
      setEditorFilePath(filePath);
      setEditorContent(content);
      setEditorContentType(contentType);
      setEditorOpen(true);
    },
    onDownloadStart: (_fileName: string, _fileSize: number, token: string) => {
      const a = document.createElement('a');
      a.href = `/api/download/${token}`;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(() => a.remove(), 100);
    },
  }), []);

  // Modifier source for the terminal
  const modifierSource = useMemo(() => {
    return {
      consumeModifiers: () => softkeyBarRef.current?.consumeModifiers() ?? { ctrl: false, alt: false, shift: false },
      clearModifiers: () => softkeyBarRef.current?.clearModifiers(),
      consumeModifierForTapSelection: (mod: 'alt' | 'shift') =>
        softkeyBarRef.current?.consumeModifierForTapSelection(mod) ?? false,
    };
  }, []);

  const handleApplyProfile = useCallback((p: Profile, device: 'desktop' | 'mobile') => {
    setSelectedProfileName(device, p.name);
    // Only update runtime if the applied profile is for the current device
    if ((device === 'mobile') === isMobile) setProfile(p);
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

  const handleEditorSave = useCallback((content: string) => {
    terminalRef.current?.core?.sendEditorDone(content, false);
    setEditorOpen(false);
    terminalRef.current?.core?.focus();
  }, []);

  const handleEditorCancel = useCallback(() => {
    // For images (view-only), send empty content to avoid a multi-MB round-trip
    const isImage = editorContentType?.startsWith('image/') ?? false;
    terminalRef.current?.core?.sendEditorDone(isImage ? '' : editorContent, true);
    setEditorOpen(false);
    terminalRef.current?.core?.focus();
  }, [editorContent, editorContentType]);

  const handleReconnect = useCallback(() => {
    setConnectionClosedReason(null);
    terminalRef.current?.core?.reconnect();
    terminalRef.current?.core?.focus();
  }, []);

  return (
    <>
      {/* Terminal area — flex-1, always present for layout stability */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {profileReady && !pendingShellSelection && (
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
      </div>

      {/* Bottom panels — normal flow flex items (top to bottom = visual bottom to top) */}
      <BatchInputPanel
        open={batchInputOpen}
        onSubmit={handleBatchSubmit}
        onClose={() => { setBatchInputOpen(false); terminalRef.current?.core?.focus(); }}
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

      <SoftkeyBar
        ref={softkeyBarRef}
        pages={softkeyConfig.pages}
        customKeys={softkeyConfig.customKeys}
        containers={softkeyConfig.containers}
        activeContainerId={openContainerId}
        softkeySize={softkeySize}
        hasAlerts={alertedSessionIds.size > 0}
        onSessionsOpen={() => setSessionPanelOpen(true)}
        onMeterToggle={() => setMeterOpen(prev => !prev)}
        onAction={(action, mods) => terminalRef.current?.core?.handleSoftkeyAction(action, mods)}
        onPaste={handlePaste}
        onBatchInputToggle={() => setBatchInputOpen(prev => !prev)}
        onBatchSubmit={handleBatchSubmit}
        onContainerToggle={handleContainerToggle}
        onKeepFocus={() => terminalRef.current?.core?.focus()}
        onModifiersChange={setModifiers}
      />

      {/* Overlays — absolute within #root (contain: paint) */}
      <RemoteEditorPanel
        open={editorOpen}
        filePath={editorFilePath}
        content={editorContent}
        contentType={editorContentType}
        onSave={handleEditorSave}
        onCancel={handleEditorCancel}
      />

      {pendingShellSelection && initialShells.length > 0 && (
        <ShellSelectionPanel shells={initialShells} onSelect={handleInitialShellSelect} />
      )}

      <SessionPanel
        open={sessionPanelOpen}
        onClose={() => { setSessionPanelOpen(false); terminalRef.current?.core?.focus(); }}
        currentSessionId={currentSessionId}
        alertedSessionIds={alertedSessionIds}
        onSwitchSession={handleSwitchSession}
        onCreateSession={handleCreateSession}
        onSettingsOpen={() => setSettingsOpen(true)}
        onNoSessionsLeft={handleNoSessionsLeft}
      />

      <SystemMeterPanel
        open={meterOpen}
        metrics={metricsRef.current}
        onClose={() => setMeterOpen(false)}
      />

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        currentProfile={profile}
        isMobile={isMobile}
        onApply={handleApplyProfile}
      />

      <ImagePasteErrorDialog
        error={imagePasteError}
        onClose={() => setImagePasteError(null)}
      />

      <ConnectionClosedDialog
        reason={connectionClosedReason}
        onReconnect={handleReconnect}
      />

      {/* Notification toasts */}
      <Toaster />
    </>
  );
}
