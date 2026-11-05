// The iOS app's native softkey bar, web side: the payload the web client
// sends with `setSoftkeyBar`, and the dispatch of the app's key presses.
// The web client stays the single owner of the profile, key behaviors and
// sticky state; the app only draws keys and reports presses. See
// docs/todo-design-ios-native-softkey-bar.md and
// docs/todo-design-ios-web-compat.md.

import {
  getKeySpec,
  type KeyBehavior, type KeySpec, type ModifierFlags, type SoftkeyContainerSpec,
  type RepeatPolicy,
} from './softkey-types.ts';
import type {
  AppSoftkey, AppSoftkeyChild, AppSoftkeyRepeat, AppSoftkeyState,
  MobittyNativeBridge, SoftkeyBarPayload,
} from './native-bridge.ts';

/// First app release that draws the softkey bar natively; quoted in the
/// "update the app" notice.
export const APP_SOFTKEY_BAR_SINCE = '1.2.0';

// --- Capability ---

/// True when the app declares it draws the softkey bar. Missing or any value
/// other than `true` means an older app: the web bar stays.
export function hasAppSoftkeyBar(bridge: MobittyNativeBridge | undefined): boolean {
  return bridge?.capabilities.appSoftkeyBar === true;
}

/// Lists the capabilities the app declared as `true`, for About. Includes
/// names this client doesn't know.
export function declaredCapabilities(bridge: MobittyNativeBridge): string[] {
  return Object.entries(bridge.capabilities)
    .filter(([, value]) => value === true)
    .map(([name]) => name);
}

// --- Hold-to-repeat timing ---

/// Interval of a held key's repeat ticks. Shared by the web bar and the
/// payload so the app repeats at the web bar's rate.
export function repeatIntervalMs(repeat: RepeatPolicy): number | null {
  if (repeat.kind !== 'hold') return null;
  return repeat.interval === 'wheel' ? 60 : 120;
}

// --- Key dispatch ---

/// What a key press can do outside the terminal. One set per bar; both the
/// web keys and the app's keys go through `runKeyBehavior` with it.
export interface KeyBehaviorHandlers {
  toggleModifier: (modifier: keyof ModifierFlags) => void;
  paste: () => void;
  fileUpload: () => void;
  batchInputToggle: () => void;
  meterToggle: () => void;
  containerToggle: (containerId: string) => void;
  consumeModifiers: () => ModifierFlags;
  emptyModifiers: () => ModifierFlags;
  action: (behavior: KeyBehavior, modifiers: ModifierFlags) => void;
}

/// Runs a key's behavior. `consumesModifiers` mirrors the KeySpec flag:
/// send-virtual / send-char take the sticky ctrl/alt/shift, everything else
/// leaves them armed.
export function runKeyBehavior(
  behavior: KeyBehavior,
  consumesModifiers: boolean,
  handlers: KeyBehaviorHandlers,
): void {
  switch (behavior.kind) {
    case 'toggle-modifier':
      handlers.toggleModifier(behavior.modifier);
      return;
    case 'paste':
      handlers.paste();
      return;
    case 'file-upload':
      handlers.fileUpload();
      return;
    case 'batch-input-toggle':
      handlers.batchInputToggle();
      return;
    case 'meter-toggle':
      handlers.meterToggle();
      return;
    case 'container-toggle':
      handlers.containerToggle(behavior.containerId);
      return;
    default: {
      const mods = consumesModifiers ? handlers.consumeModifiers() : handlers.emptyModifiers();
      handlers.action(behavior, mods);
    }
  }
}

/// The spec the app's key stands for. The web bar's inline input is a text
/// field the app can't draw, so the app shows it as a key that opens the
/// input panel instead.
export function appKeySpec(id: string, customKeyMap: Map<string, KeySpec>): KeySpec {
  const spec = getKeySpec(id, customKeyMap);
  if (spec.behavior.kind === 'inline-input') {
    return { ...spec, behavior: { kind: 'batch-input-toggle' } };
  }
  return spec;
}

/// Dispatches `onSoftkeyPress(id)` exactly as a tap on the web key with the
/// same id. Container keys never reach the web (the app opens containers
/// itself), so a container press is ignored rather than opening the web
/// panel under the app's bar.
export function dispatchAppSoftkeyPress(
  id: string,
  customKeyMap: Map<string, KeySpec>,
  handlers: KeyBehaviorHandlers,
): void {
  const spec = appKeySpec(id, customKeyMap);
  if (spec.behavior.kind === 'container-toggle') return;
  runKeyBehavior(spec.behavior, spec.consumesModifiers, handlers);
}

// --- Payload ---

export interface AppSoftkeyBarInput {
  pages: string[][];
  customKeyMap: Map<string, KeySpec>;
  containers: SoftkeyContainerSpec[];
  modifiers: ModifierFlags;
  activeContainerId: string | null;
  batchInputOpen: boolean;
  hasAlerts: boolean;
  hidden: boolean;
  /** The profile's `sessionSwitcherHotkey` ('' = none), for the app's settings hint. */
  sessionHotkey: string;
}

function keyState(spec: KeySpec, input: AppSoftkeyBarInput): AppSoftkeyState | undefined {
  const behavior = spec.behavior;
  switch (behavior.kind) {
    case 'toggle-modifier':
      return input.modifiers[behavior.modifier] ? 'on' : undefined;
    case 'batch-input-toggle':
      return input.batchInputOpen ? 'on' : undefined;
    case 'container-toggle':
      return input.activeContainerId === behavior.containerId ? 'on' : undefined;
    default:
      return undefined;
  }
}

function appSoftkeyChild(id: string, input: AppSoftkeyBarInput): AppSoftkeyChild {
  const spec = appKeySpec(id, input.customKeyMap);
  const key: AppSoftkeyChild = { id, label: spec.label };
  const state = keyState(spec, input);
  if (state !== undefined) key.state = state;
  const intervalMs = repeatIntervalMs(spec.repeat);
  if (intervalMs !== null) {
    const repeat: AppSoftkeyRepeat = { intervalMs };
    key.repeat = repeat;
  }
  return key;
}

function appSoftkey(id: string, input: AppSoftkeyBarInput): AppSoftkey {
  const key: AppSoftkey = appSoftkeyChild(id, input);
  const spec = appKeySpec(id, input.customKeyMap);
  if (spec.behavior.kind === 'container-toggle') {
    const containerId = spec.behavior.containerId;
    const container = input.containers.find(c => c.id === containerId);
    // The app draws one level of container: a container listed inside
    // another is left out, as its press would have nowhere to go.
    key.children = (container?.keys ?? [])
      .filter(childId => appKeySpec(childId, input.customKeyMap).behavior.kind !== 'container-toggle')
      .map(childId => appSoftkeyChild(childId, input));
  }
  return key;
}

export function buildSoftkeyBarPayload(input: AppSoftkeyBarInput): SoftkeyBarPayload {
  return {
    keys: input.pages.flat().map(id => appSoftkey(id, input)),
    sessionsBadge: input.hasAlerts,
    hidden: input.hidden,
    sessionHotkey: input.sessionHotkey,
  };
}

/// Wraps a sender so an unchanged payload isn't re-sent. Re-renders that
/// don't change the bar cost nothing on the bridge.
export function createDedupedSender(
  send: (payload: SoftkeyBarPayload) => void,
): (payload: SoftkeyBarPayload) => void {
  let last: string | null = null;
  return (payload) => {
    const serialized = JSON.stringify(payload);
    if (serialized === last) return;
    last = serialized;
    send(payload);
  };
}

// --- "Update the app" notice ---

const UPDATE_APP_NOTICE_KEY = 'mobitty.updateAppNotice.appSoftkeyBar';

export const UPDATE_APP_NOTICE_TEXT =
  `Mobitty for iOS ${APP_SOFTKEY_BAR_SINCE} or later draws the softkey bar natively. Update it from the App Store.`;

export interface NoticeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
}

/// True inside an app that predates the native bar, unless this device has
/// already shown the notice.
export function shouldShowUpdateAppNotice(
  bridge: MobittyNativeBridge | undefined,
  storage: NoticeStorage,
): boolean {
  if (!bridge || hasAppSoftkeyBar(bridge)) return false;
  try {
    return storage.getItem(UPDATE_APP_NOTICE_KEY) === null;
  } catch {
    return false;
  }
}

export function markUpdateAppNoticeShown(storage: NoticeStorage): void {
  try {
    storage.setItem(UPDATE_APP_NOTICE_KEY, '1');
  } catch {
    // storage unavailable: the notice may show again, which is harmless
  }
}
