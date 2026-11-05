// Type-safe view of `window.mobittyNative` — the shim that the iOS app's
// NativeBridge.swift injects at document-start. The shim exists only when
// running inside the WKWebView shell; on PWA/desktop it's undefined.
//
// The protocol is mirrored in mobitty-ios/Mobitty/NativeBridge.swift (search
// for "JS shim"). Keep the two in sync when adding fields.

import type { KeyBehavior, ModifierFlags } from './softkey-types.ts';

export type KeyboardMode = 'system' | 'terminal' | 'dismissed';

/// Features the app declares to the web client. A field left out means the
/// app predates that feature (old behavior); fields this client doesn't know
/// are ignored. See docs/todo-design-ios-web-compat.md.
export interface NativeCapabilities {
  readonly keyboard: boolean;
  readonly push: boolean;
  /// The app draws the softkey bar natively from `setSoftkeyBar` and reports
  /// presses on `onSoftkeyPress` / `onSoftkeyLongPress`. Since app 1.2.0.
  readonly appSoftkeyBar?: boolean;
  /// The app sends the iPhone Duo screen pose (`screenPose`,
  /// `onScreenPose`). Since app 1.2.0.
  readonly screenPose?: boolean;
}

/// Features this web client declares to the app in `hello`.
export interface WebCapabilities {
  appSoftkeyBar: boolean;
  /// This client lays out the Duo's panes and tabletop from the screen pose;
  /// the app applies its tabletop keyboard rule only when declared. Since
  /// server 0.7.0. Optional until the client lays out tabletop, then sent
  /// as `true` (docs/todo-design-ios-iphone-duo.md).
  screenPose?: boolean;
}

/// The iPhone Duo's screen shape: closed (`column`, turned `columnTurned`)
/// or open (`wide`, `tall`). Absent (null pose) off the Duo.
export type DuoShape = 'column' | 'columnTurned' | 'wide' | 'tall';

/// A rect in window coordinates, CSS px (1 pt = 1 px).
export interface PoseRect { x: number; y: number; w: number; h: number; }

/// The Duo pose the app sends. See src/screen-pose.ts.
export interface ScreenPosePayload {
  shape: DuoShape;
  /// The fold band is active (book, tabletop).
  folded: boolean;
  /// The fold band, 40 wide; listed flat too; null when closed.
  band: PoseRect | null;
  /// Closed: the safe content rect; open: the leading/top pane.
  paneA: PoseRect;
  /// Open only: the trailing/bottom pane.
  paneB: PoseRect | null;
}

export interface HelloPayload {
  capabilities: WebCapabilities;
  /// The mobitty npm package version this client was built with. Display
  /// only — never compared to decide behavior.
  serverVersion: string;
}

export type AppSoftkeyState = 'on' | 'locked';

export interface AppSoftkeyRepeat {
  intervalMs: number;
}

export interface AppSoftkeyChild {
  id: string;
  label: string;
  state?: AppSoftkeyState;
  repeat?: AppSoftkeyRepeat;
}

export interface AppSoftkey extends AppSoftkeyChild {
  /// Present on container keys only. The app opens and closes the container
  /// itself; a child's press arrives as `onSoftkeyPress(childId)`.
  children?: AppSoftkeyChild[];
}

export interface SoftkeyBarPayload {
  /// Every page's keys in page order, flattened. The sessions and keyboard
  /// buttons are the app's own pinned controls and are not listed.
  keys: AppSoftkey[];
  /// Alert dot on the app's sessions button.
  sessionsBadge: boolean;
  /// True when the web would hide its own bar; the app draws nothing.
  hidden: boolean;
  /// The profile's session switcher hotkey as written in the profile
  /// (e.g. 'Ctrl+Shift+q'), '' when none. The app names it in its
  /// settings, the way to the session list when its bar is hidden.
  sessionHotkey: string;
}

export interface MobittyNativeBridge {
  readonly __installed: true;
  readonly version: number;
  readonly platform: 'ios';
  readonly capabilities: NativeCapabilities;
  /// App version (`CFBundleShortVersionString`), for display only. Absent on
  /// apps before 1.2.0.
  readonly appVersion?: string;
  /// The current Duo pose, set by the shim at document start and on every
  /// change; null off the Duo. Absent on apps without `screenPose`.
  readonly screenPose?: ScreenPosePayload | null;

  onKeyAction: (action: KeyBehavior, modifiers: ModifierFlags | null) => void;
  onKeyboardModeChanged: (mode: KeyboardMode) => void;
  onPushTokenRegistered: (token: string) => void;
  onSwitchSessionRequested: (sessionId: string) => void;
  /// Native-shell asks the web client to open its session list. Triggered
  /// from a native gesture (left-edge swipe, when enabled in iOS Settings).
  /// The web override should flip the `SessionPanel` open.
  onOpenSessionListRequested: () => void;
  /// One press, or one hold-to-repeat tick, of a key in the app's softkey
  /// bar. The shim's default is a no-op; the web overrides it while the app
  /// draws the bar. Absent on apps without `appSoftkeyBar`.
  onSoftkeyPress?: (id: string) => void;
  /// Long press of a key in the app's softkey bar. Same lifecycle as
  /// `onSoftkeyPress`.
  onSoftkeyLongPress?: (id: string) => void;
  /// The Duo pose changed (null: no longer a Duo). The shim's default is a
  /// no-op; the web overrides it. Absent on apps without `screenPose`.
  onScreenPose?: (pose: ScreenPosePayload | null) => void;

  /// Web → app handshake, sent once at mount. Absent on apps before 1.2.0.
  hello?: (payload: HelloPayload) => void;
  /// Keys, labels and states for the app's softkey bar. Sent whenever any
  /// of them changes. Absent on apps without `appSoftkeyBar`.
  setSoftkeyBar?: (payload: SoftkeyBarPayload) => void;

  requestKeyboardMode: (mode: KeyboardMode) => void;
  setSoftkeyConfig: (config: unknown) => void;
  // Optional: present only on iOS shells that ship the backdrop-color
  // bridge. Callers must guard with `?.()` before invoking.
  setBackdropColor?: (color: string) => void;
  registerForPush: (payload: unknown) => void;
  /// Ask the iOS shell to present its native server-management dialog.
  /// The list, edit form, and connection retry/rollback all live on the
  /// native side — the web client just fires this and waits.
  requestOpenServersDialog: () => void;
  /// Short-press of the SoftkeyBar keyboard toggle. iOS owns the cycle
  /// state machine: rotates through user-defined custom keyboard layouts,
  /// falling through to the system keyboard after the last layout.
  /// Optional so the web works against older iOS shells.
  requestKeyboardCycle?: () => void;
  /// Open the iOS keyboard customizer sheet. Triggered by the
  /// "Customize iOS keyboard…" button in the web SettingsDialog softkeys
  /// tab. Optional so the web works against older iOS shells.
  requestOpenKeyboardSettings?: () => void;
  /// Toggle iOS shake-to-undo. Default is off — call with `true` while an
  /// undoable textarea (remote editor, batch input panel) is focused, and
  /// `false` on blur or unmount. Native independently resets to false on
  /// page navigation and app backgrounding, so callers shouldn't assume
  /// their last value persists. Optional so the web works against older
  /// iOS shells.
  setShakeToUndo?: (enabled: boolean) => void;
  /// Read `UIPasteboard.general` directly via the native side, bypassing
  /// WKWebView's cross-app clipboard gate (which silently denies
  /// `navigator.clipboard.read`/`readText` for content from other apps).
  /// Touching the pasteboard here triggers iOS 16+'s *Allow Paste from
  /// "…"* prompt — the intended user-facing consent gate.
  /// Resolves to `null` only if the bridge is missing in this iOS shell.
  /// An empty pasteboard (or user denying the prompt) resolves to `{}`.
  /// Optional so the web works against older iOS shells.
  readClipboard?: () => Promise<{
    text?: string;
    image?: { mimeType: string; base64: string };
  } | null>;
  /// Write text into `UIPasteboard.general` directly. Used by the OSC 52
  /// copy path: `navigator.clipboard.writeText` is blocked in WKWebView
  /// without a user gesture, but a TUI emitting OSC 52 has no gesture, so
  /// writes route through native. Pasteboard writes don't trigger the iOS
  /// 16+ *Allow Paste from "…"* prompt — only reads do. Fire-and-forget.
  /// Optional so the web works against older iOS shells.
  writeClipboard?: (text: string) => void;
}

declare global {
  interface Window {
    mobittyNative?: MobittyNativeBridge;
  }
}

export function getNativeBridge(): MobittyNativeBridge | undefined {
  if (typeof window === 'undefined') return undefined;
  const bridge = window.mobittyNative;
  if (bridge && bridge.platform === 'ios') return bridge;
  return undefined;
}

export function isNativeApp(): boolean {
  return getNativeBridge() !== undefined;
}
