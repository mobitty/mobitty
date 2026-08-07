// Type-safe view of `window.mobittyNative` — the shim that the iOS app's
// NativeBridge.swift injects at document-start. The shim exists only when
// running inside the WKWebView shell; on PWA/desktop it's undefined.
//
// The protocol is mirrored in mobitty-ios/Mobitty/NativeBridge.swift (search
// for "JS shim"). Keep the two in sync when adding fields.

import type { KeyBehavior, ModifierFlags } from './softkey-types';

export type KeyboardMode = 'system' | 'terminal' | 'dismissed';

export interface MobittyNativeBridge {
  readonly __installed: true;
  readonly version: number;
  readonly platform: 'ios';
  readonly capabilities: { keyboard: boolean; push: boolean };

  onKeyAction: (action: KeyBehavior, modifiers: ModifierFlags | null) => void;
  onKeyboardModeChanged: (mode: KeyboardMode) => void;
  onPushTokenRegistered: (token: string) => void;
  onSwitchSessionRequested: (sessionId: string) => void;
  /// Native-shell asks the web client to open its session list. Triggered
  /// from a native gesture (left-edge swipe, when enabled in iOS Settings).
  /// The web override should flip the `SessionPanel` open.
  onOpenSessionListRequested: () => void;

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
