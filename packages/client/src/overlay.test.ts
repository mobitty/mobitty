import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal DOM shim — must be installed before importing OverlayAddon
// because the constructor calls document.createElement('div').

interface MockNode {
  parentNode: MockNode | null;
  textContent: string;
  style: Record<string, string>;
  _children: MockNode[];
  appendChild(child: MockNode): MockNode;
  removeChild(child: MockNode): MockNode;
  addEventListener(...args: unknown[]): void;
  getBoundingClientRect(): { width: number; height: number; top: number; left: number };
}

function createMockNode(): MockNode {
  const node: MockNode = {
    parentNode: null,
    textContent: '',
    style: {},
    _children: [],
    appendChild(child: MockNode) {
      child.parentNode = node;
      node._children.push(child);
      return child;
    },
    removeChild(child: MockNode) {
      const i = node._children.indexOf(child);
      if (i >= 0) node._children.splice(i, 1);
      child.parentNode = null;
      return child;
    },
    addEventListener() {},
    getBoundingClientRect() {
      return { width: 800, height: 600, top: 0, left: 0 };
    },
  };
  return node;
}

// Install global document mock
const g = globalThis as Record<string, unknown>;
if (!g['document']) {
  g['document'] = { createElement: () => createMockNode() };
}

// Dynamic import after DOM shim is in place
const { OverlayAddon } = await import('./overlay.ts');

/** Set the private `terminal` field on an OverlayAddon via Object.defineProperty. */
function activateAddon(addon: OverlayAddon, element: MockNode): void {
  Object.defineProperty(addon, 'terminal', {
    value: { element },
    writable: true,
    configurable: true,
  });
}

/** Read the private `overlayNode` field. */
function getOverlayNode(addon: OverlayAddon): MockNode {
  const rec = addon as Record<string, unknown>;
  return rec['overlayNode'] as MockNode;
}

describe('OverlayAddon', () => {
  let addon: OverlayAddon;
  let container: MockNode;

  beforeEach(() => {
    addon = new OverlayAddon();
    container = createMockNode();
    activateAddon(addon, container);
  });

  describe('showOverlay', () => {
    it('appends overlay node to terminal element', () => {
      addon.showOverlay('hello');
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.parentNode, container);
      assert.equal(overlay.textContent, 'hello');
    });

    it('replaces previous overlay text', () => {
      addon.showOverlay('first');
      addon.showOverlay('second');
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.textContent, 'second');
      // Still only one child (reuses the same node)
      assert.equal(container._children.length, 1);
    });

    it('overlay without timeout stays in DOM indefinitely', () => {
      addon.showOverlay('Reconnecting...');
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.parentNode, container);
    });
  });

  describe('hideOverlay', () => {
    it('removes overlay from DOM', () => {
      addon.showOverlay('Reconnecting...');
      addon.hideOverlay();
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.parentNode, null);
      assert.equal(container._children.length, 0);
    });

    it('is safe to call when overlay is not shown', () => {
      // Should not throw
      addon.hideOverlay();
    });

    it('cancels pending timeout from showOverlay', (t) => {
      // Show with timeout — the timeout would eventually remove the node
      addon.showOverlay('Reconnected', 5000);
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.parentNode, container);

      // hideOverlay should remove it immediately and cancel the timer
      addon.hideOverlay();
      assert.equal(overlay.parentNode, null);

      // Verify no timer fires after hide (would re-modify the node)
      t.mock.timers.enable({ apis: ['setTimeout'] });
      t.mock.timers.tick(10000);
      // Node is still detached — no timer re-attached it
      assert.equal(overlay.parentNode, null);
    });
  });

  describe('showOverlay clears "Reconnecting..." on first open (regression)', () => {
    it('hideOverlay clears a no-timeout overlay so next showOverlay with timeout works', () => {
      // Simulate: initial connection fails → "Reconnecting..." shown (no timeout)
      addon.showOverlay('Reconnecting...');
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.parentNode, container);
      assert.equal(overlay.textContent, 'Reconnecting...');

      // Simulate: reconnect succeeds → hideOverlay called in onSocketOpen
      addon.hideOverlay();
      assert.equal(overlay.parentNode, null);

      // Subsequent showOverlay('Reconnected', 300) should work normally
      addon.showOverlay('Reconnected', 300);
      assert.equal(overlay.parentNode, container);
      assert.equal(overlay.textContent, 'Reconnected');
    });

    it('hideOverlay followed by no showOverlay leaves overlay hidden', () => {
      // Simulate: "Reconnecting..." shown, then first successful open
      addon.showOverlay('Reconnecting...');
      addon.hideOverlay();
      const overlay = getOverlayNode(addon);
      assert.equal(overlay.parentNode, null);
      // On first open (opened=false), no showOverlay is called → overlay stays hidden
    });
  });
});
