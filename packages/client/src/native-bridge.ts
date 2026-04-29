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

  requestKeyboardMode: (mode: KeyboardMode) => void;
  setSoftkeyConfig: (config: unknown) => void;
  // Optional: present only on iOS shells that ship the backdrop-color
  // bridge. Callers must guard with `?.()` before invoking.
  setBackdropColor?: (color: string) => void;
  // Optional: present only on iOS shells that ship the body-bg-color
  // bridge. The shell paints this into the top safe-area strip so the
  // status-bar background blends with the terminal area below it.
  setBodyBgColor?: (color: string) => void;
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
