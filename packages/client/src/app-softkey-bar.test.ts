import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSoftkeyBarPayload, createDedupedSender, dispatchAppSoftkeyPress,
  hasAppSoftkeyBar, declaredCapabilities, runKeyBehavior, shouldShowUpdateAppNotice,
  markUpdateAppNoticeShown, type AppSoftkeyBarInput, type KeyBehaviorHandlers,
} from './app-softkey-bar.ts';
import {
  DEFAULT_MOBILE_CONTAINERS, DEFAULT_MOBILE_CUSTOM_KEYS, DEFAULT_MOBILE_PAGES,
  buildContainerKeyMap, buildCustomKeyMap, emptyModifiers, getKeySpec, mergeKeyMaps,
  type KeySpec, type SoftkeyContainerSpec, type SoftkeyCustomKeySpec,
} from './softkey-types.ts';
import type { MobittyNativeBridge, SoftkeyBarPayload } from './native-bridge.ts';

function keyMap(custom: SoftkeyCustomKeySpec[], containers: SoftkeyContainerSpec[]): Map<string, KeySpec> {
  return mergeKeyMaps(buildCustomKeyMap(custom), buildContainerKeyMap(containers));
}

function defaultInput(overrides: Partial<AppSoftkeyBarInput> = {}): AppSoftkeyBarInput {
  return {
    pages: DEFAULT_MOBILE_PAGES,
    customKeyMap: keyMap(DEFAULT_MOBILE_CUSTOM_KEYS, DEFAULT_MOBILE_CONTAINERS),
    containers: DEFAULT_MOBILE_CONTAINERS,
    modifiers: emptyModifiers(),
    activeContainerId: null,
    batchInputOpen: false,
    hasAlerts: false,
    hidden: false,
    ...overrides,
  };
}

const EXTRA_CHILDREN = [
  { id: 'system_meter', label: 'Meter' },
  { id: 'ctrl_c', label: 'C-c' },
  { id: 'home', label: 'Home' },
  { id: 'end', label: 'End' },
  { id: 'up', label: '↑', repeat: { intervalMs: 120 } },
  { id: 'down', label: '↓', repeat: { intervalMs: 120 } },
  { id: 'left', label: '←', repeat: { intervalMs: 120 } },
  { id: 'right', label: '→', repeat: { intervalMs: 120 } },
];

describe('buildSoftkeyBarPayload', () => {
  it('lists the default mobile profile in order, containers with children', () => {
    assert.deepEqual(buildSoftkeyBarPayload(defaultInput()), {
      keys: [
        { id: 'esc', label: 'Esc' },
        { id: 'ctrl', label: 'Ctrl' },
        { id: 'alt', label: 'Alt' },
        { id: 'shift', label: 'Shift' },
        { id: 'tab', label: 'Tab' },
        { id: 'batch_input', label: 'Input' },
        { id: 'extra', label: 'Extra', children: EXTRA_CHILDREN },
        { id: 'paste', label: 'Paste' },
        { id: 'upload', label: 'Upload' },
      ],
      sessionsBadge: false,
      hidden: false,
    });
  });

  it('flattens every page in page order', () => {
    const payload = buildSoftkeyBarPayload(defaultInput({ pages: [['esc', 'tab'], ['wheel_up', 'x']] }));
    assert.deepEqual(payload.keys, [
      { id: 'esc', label: 'Esc' },
      { id: 'tab', label: 'Tab' },
      { id: 'wheel_up', label: 'W↑', repeat: { intervalMs: 60 } },
      { id: 'x', label: 'x' },
    ]);
  });

  it('marks a toggled modifier on', () => {
    const payload = buildSoftkeyBarPayload(defaultInput({ modifiers: { ctrl: true, alt: false, shift: false } }));
    assert.deepEqual(payload.keys[1], { id: 'ctrl', label: 'Ctrl', state: 'on' });
    assert.deepEqual(payload.keys[2], { id: 'alt', label: 'Alt' });
  });

  it('marks the open input panel and container on', () => {
    const payload = buildSoftkeyBarPayload(defaultInput({ batchInputOpen: true, activeContainerId: 'extra' }));
    assert.equal(payload.keys[5]?.state, 'on');
    assert.equal(payload.keys[6]?.state, 'on');
  });

  it('carries modifier state into container children', () => {
    const containers = [{ id: 'mods', label: 'Mods', keys: ['ctrl', 'shift', 'mods'] }];
    const payload = buildSoftkeyBarPayload(defaultInput({
      pages: [['mods']],
      containers,
      customKeyMap: keyMap([], containers),
      modifiers: { ctrl: false, alt: false, shift: true },
    }));
    // A container nested in itself is left out of its children.
    assert.deepEqual(payload.keys, [{
      id: 'mods', label: 'Mods',
      children: [{ id: 'ctrl', label: 'Ctrl' }, { id: 'shift', label: 'Shift', state: 'on' }],
    }]);
  });

  it('shows the alert badge', () => {
    assert.equal(buildSoftkeyBarPayload(defaultInput({ hasAlerts: true })).sessionsBadge, true);
  });

  it('passes the hidden rule through and keeps the keys', () => {
    const payload = buildSoftkeyBarPayload(defaultInput({ hidden: true }));
    assert.equal(payload.hidden, true);
    assert.equal(payload.keys.length, 9);
  });

  it('shows the inline input as an input key', () => {
    const payload = buildSoftkeyBarPayload(defaultInput({ pages: [['inline_input']] }));
    assert.deepEqual(payload.keys, [{ id: 'inline_input', label: 'Input' }]);
  });
});

describe('createDedupedSender', () => {
  it('sends only changed payloads', () => {
    const sent: SoftkeyBarPayload[] = [];
    const send = createDedupedSender(p => sent.push(p));
    send(buildSoftkeyBarPayload(defaultInput()));
    send(buildSoftkeyBarPayload(defaultInput()));
    send(buildSoftkeyBarPayload(defaultInput({ hasAlerts: true })));
    send(buildSoftkeyBarPayload(defaultInput()));
    assert.equal(sent.length, 3);
  });
});

// --- Dispatch ---

type Call = [string, ...unknown[]];

function recordingHandlers(calls: Call[], armed: { ctrl: boolean }): KeyBehaviorHandlers {
  return {
    toggleModifier: m => calls.push(['toggleModifier', m]),
    paste: () => calls.push(['paste']),
    fileUpload: () => calls.push(['fileUpload']),
    batchInputToggle: () => calls.push(['batchInputToggle']),
    meterToggle: () => calls.push(['meterToggle']),
    containerToggle: id => calls.push(['containerToggle', id]),
    consumeModifiers: () => {
      const mods = { ctrl: armed.ctrl, alt: false, shift: false };
      armed.ctrl = false;
      calls.push(['consumeModifiers']);
      return mods;
    },
    emptyModifiers,
    action: (behavior, mods) => calls.push(['action', behavior, mods]),
  };
}

function webPress(id: string, map: Map<string, KeySpec>): Call[] {
  const calls: Call[] = [];
  const spec = getKeySpec(id, map);
  runKeyBehavior(spec.behavior, spec.consumesModifiers, recordingHandlers(calls, { ctrl: true }));
  return calls;
}

function appPress(id: string, map: Map<string, KeySpec>): Call[] {
  const calls: Call[] = [];
  dispatchAppSoftkeyPress(id, map, recordingHandlers(calls, { ctrl: true }));
  return calls;
}

describe('dispatchAppSoftkeyPress', () => {
  const map = keyMap(DEFAULT_MOBILE_CUSTOM_KEYS, DEFAULT_MOBILE_CONTAINERS);
  const ids = [
    ...DEFAULT_MOBILE_PAGES.flat().filter(id => id !== 'extra'),
    ...(DEFAULT_MOBILE_CONTAINERS[0]?.keys ?? []),
    'enter', 'wheel_up', 'select_all', 'q', 'unknown_key',
  ];

  for (const id of ids) {
    it(`runs the web behavior for ${id}`, () => {
      const app = appPress(id, map);
      assert.ok(app.length > 0);
      assert.deepEqual(app, webPress(id, map));
    });
  }

  it('consumes an armed modifier on a char key', () => {
    assert.deepEqual(appPress('q', map), [
      ['consumeModifiers'],
      ['action', { kind: 'send-char', char: 'q' }, { ctrl: true, alt: false, shift: false }],
    ]);
  });

  it('ignores a container press, which the app handles itself', () => {
    assert.deepEqual(appPress('extra', map), []);
  });

  it('opens the input panel for the inline input key', () => {
    assert.deepEqual(appPress('inline_input', map), [['batchInputToggle']]);
  });
});

// --- Capabilities and notice ---

function fakeBridge(capabilities: Record<string, boolean>): MobittyNativeBridge {
  const noop = (): void => {};
  return {
    __installed: true, version: 1, platform: 'ios',
    capabilities: { keyboard: true, push: true, ...capabilities },
    onKeyAction: noop, onKeyboardModeChanged: noop, onPushTokenRegistered: noop,
    onSwitchSessionRequested: noop, onOpenSessionListRequested: noop,
    requestKeyboardMode: noop, setSoftkeyConfig: noop, registerForPush: noop,
    requestOpenServersDialog: noop,
  };
}

function memoryStorage(): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } {
  const data = new Map<string, string>();
  return { getItem: k => data.get(k) ?? null, setItem: (k, v) => { data.set(k, v); } };
}

describe('appSoftkeyBar capability', () => {
  it('is present when the app declares it', () => {
    assert.equal(hasAppSoftkeyBar(fakeBridge({ appSoftkeyBar: true })), true);
  });
  it('is absent on an older app or outside the app', () => {
    assert.equal(hasAppSoftkeyBar(fakeBridge({})), false);
    assert.equal(hasAppSoftkeyBar(undefined), false);
  });
  it('ignores unknown extra capabilities', () => {
    assert.equal(hasAppSoftkeyBar(fakeBridge({ appSoftkeyBar: true, futureThing: true })), true);
    assert.equal(hasAppSoftkeyBar(fakeBridge({ futureThing: true })), false);
  });
  it('lists declared capabilities for About, unknown ones included', () => {
    assert.deepEqual(declaredCapabilities(fakeBridge({ appSoftkeyBar: true, futureThing: true })),
      ['keyboard', 'push', 'appSoftkeyBar', 'futureThing']);
  });
});

describe('update-the-app notice', () => {
  it('shows once per device inside an older app', () => {
    const storage = memoryStorage();
    const bridge = fakeBridge({});
    assert.equal(shouldShowUpdateAppNotice(bridge, storage), true);
    markUpdateAppNoticeShown(storage);
    assert.equal(shouldShowUpdateAppNotice(bridge, storage), false);
  });
  it('does not show with the capability or outside the app', () => {
    const storage = memoryStorage();
    assert.equal(shouldShowUpdateAppNotice(fakeBridge({ appSoftkeyBar: true }), storage), false);
    assert.equal(shouldShowUpdateAppNotice(undefined, storage), false);
  });
});
