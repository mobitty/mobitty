import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  lastKeyboardMode, subscribeKeyboardMode, type KeyboardMode, type MobittyNativeBridge,
} from './native-bridge.ts';

function fakeBridge(): MobittyNativeBridge {
  const noop = () => {};
  return {
    __installed: true, version: 1, platform: 'ios',
    capabilities: { keyboard: true, push: true, appSoftkeyBar: true, screenPose: true },
    onKeyAction: noop, onKeyboardModeChanged: noop, onPushTokenRegistered: noop,
    onSwitchSessionRequested: noop, onOpenSessionListRequested: noop,
    requestKeyboardMode: noop, setSoftkeyConfig: noop, registerForPush: noop,
    requestOpenServersDialog: noop,
  };
}

describe('subscribeKeyboardMode', () => {
  it('delivers each change to every listener', () => {
    const bridge = fakeBridge();
    const a: KeyboardMode[] = [];
    const b: KeyboardMode[] = [];
    const offA = subscribeKeyboardMode((m) => a.push(m), bridge);
    const offB = subscribeKeyboardMode((m) => b.push(m), bridge);
    bridge.onKeyboardModeChanged('terminal');
    bridge.onKeyboardModeChanged('dismissed');
    assert.deepEqual(a, ['terminal', 'dismissed']);
    assert.deepEqual(b, ['terminal', 'dismissed']);
    assert.equal(lastKeyboardMode(), 'dismissed');
    offA();
    offB();
  });

  it('stops delivering to a listener that left, keeps the others', () => {
    const bridge = fakeBridge();
    const a: KeyboardMode[] = [];
    const b: KeyboardMode[] = [];
    const offA = subscribeKeyboardMode((m) => a.push(m), bridge);
    const offB = subscribeKeyboardMode((m) => b.push(m), bridge);
    offA();
    bridge.onKeyboardModeChanged('system');
    assert.deepEqual(a, []);
    assert.deepEqual(b, ['system']);
    offB();
  });

  it('the same function subscribed twice leaves independently', () => {
    const bridge = fakeBridge();
    const got: KeyboardMode[] = [];
    const listener = (m: KeyboardMode) => { got.push(m); };
    const off1 = subscribeKeyboardMode(listener, bridge);
    const off2 = subscribeKeyboardMode(listener, bridge);
    off1();
    bridge.onKeyboardModeChanged('terminal');
    assert.deepEqual(got, ['terminal']);
    off2();
  });

  it('restores a no-op callback when the last listener leaves', () => {
    const bridge = fakeBridge();
    const got: KeyboardMode[] = [];
    const off = subscribeKeyboardMode((m) => got.push(m), bridge);
    const dispatcher = bridge.onKeyboardModeChanged;
    off();
    assert.notEqual(bridge.onKeyboardModeChanged, dispatcher);
    bridge.onKeyboardModeChanged('terminal');
    assert.deepEqual(got, []);
    // A new subscriber installs the dispatcher again.
    const off2 = subscribeKeyboardMode((m) => got.push(m), bridge);
    bridge.onKeyboardModeChanged('system');
    assert.deepEqual(got, ['system']);
    off2();
  });

  it('a throwing listener does not stop the others', () => {
    const bridge = fakeBridge();
    const got: KeyboardMode[] = [];
    const origError = console.error;
    console.error = () => {};
    try {
      const off1 = subscribeKeyboardMode(() => { throw new Error('boom'); }, bridge);
      const off2 = subscribeKeyboardMode((m) => got.push(m), bridge);
      bridge.onKeyboardModeChanged('terminal');
      assert.deepEqual(got, ['terminal']);
      off1();
      off2();
    } finally {
      console.error = origError;
    }
  });

  it('is a no-op outside the iOS shell', () => {
    const off = subscribeKeyboardMode(() => assert.fail('called'), undefined);
    off();
  });
});
