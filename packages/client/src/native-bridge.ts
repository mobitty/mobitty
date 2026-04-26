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
  registerForPush: (payload: unknown) => void;
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
