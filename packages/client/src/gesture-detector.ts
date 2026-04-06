// Hammer.js wrapper for touch gesture detection.
// Maps Hammer events to GestureId values and handles xterm.js integration.
//
// Architecture: two independent event channels prevent conflicts with xterm.js.
//   Pointer events → Hammer (PointerEventInput) → gesture recognition
//   Touch events   → capture-phase gatekeeper   → block or pass to xterm
// xterm only listens to touch events (no pointer listeners), so Hammer's
// pointer-based detection is completely invisible to xterm.  The gatekeeper
// uses stopImmediatePropagation in the capture phase to prevent xterm's
// bubble-phase touchmove handler from firing when gestures are active.

import Hammer from 'hammerjs';
import type { GestureId, GestureMapping, GestureDirection } from './gesture-types';
export interface GestureDetectorCallbacks {
  onGesture: (gestureId: GestureId) => void;
  onContinuousScroll?: (deltaY: number) => void;
  onLongPressDefault: (clientX: number, clientY: number) => void;
  onTripleTapDefault: (clientX: number, clientY: number) => void;
}

function hammerDirectionToGesture(direction: number): GestureDirection | undefined {
  switch (direction) {
    case Hammer.DIRECTION_UP: return 'up';
    case Hammer.DIRECTION_DOWN: return 'down';
    case Hammer.DIRECTION_LEFT: return 'left';
    case Hammer.DIRECTION_RIGHT: return 'right';
    default: return undefined;
  }
}

export class GestureDetector {
  private manager: HammerManager;
  private mapping: GestureMapping;
  private callbacks: GestureDetectorCallbacks;
  private intercepting = false;
  private interceptDirection: GestureDirection | undefined;

  // Continuous scroll state — keyed by finger count (1/2/3)
  private continuousScrollGestures: ReadonlySet<string>;
  private swipeLastDeltaY: Record<number, number> = {};
  private swipeDidContinuousScroll: Record<number, boolean> = {};

  // Capture-phase touch gatekeeper: blocks touch events from reaching xterm's
  // bubble-phase handlers when gestures are mapped for the current finger count.
  private element: HTMLElement;
  private viewport: HTMLElement | null;
  private didIntercept = false;
  private onCaptureTouchMove: (e: TouchEvent) => void;
  private onCaptureTouchEnd: (e: TouchEvent) => void;

  constructor(element: HTMLElement, mapping: GestureMapping, callbacks: GestureDetectorCallbacks, continuousScrollGestures?: ReadonlySet<string>) {
    this.mapping = mapping;
    this.callbacks = callbacks;
    this.continuousScrollGestures = continuousScrollGestures ?? new Set();
    this.element = element;
    this.viewport = element.querySelector('.xterm-viewport');

    // Hammer uses pointer events — completely independent of touch events.
    // touch-action must be 'none' so the browser doesn't take over multi-finger
    // touches for native scroll/zoom, which would fire pointercancel and stop
    // delivering pointermove events that Hammer needs for gesture recognition.
    this.manager = new Hammer.Manager(element, {
      touchAction: 'none',
      inputClass: Hammer.PointerEventInput,
    });

    // --- Recognizers ---

    // Multi-finger swipes — Pan recognizers give continuous movement tracking
    // (for smooth scroll when mapped to wheel-step) plus direction at gesture end
    // (for discrete actions). Lower threshold (10) for responsive continuous tracking.
    const swipe2 = new Hammer.Pan({ event: 'swipe2', pointers: 2, direction: Hammer.DIRECTION_ALL, threshold: 10 });
    const swipe3 = new Hammer.Pan({ event: 'swipe3', pointers: 3, direction: Hammer.DIRECTION_ALL, threshold: 10 });

    // Single-finger pan (for swipe-1 direction tracking)
    const pan1 = new Hammer.Pan({ event: 'pan1', pointers: 1, direction: Hammer.DIRECTION_ALL, threshold: 30 });

    // Single-finger flick (velocity-based, fires at gesture end)
    const flick1 = new Hammer.Swipe({ event: 'flick1', pointers: 1, direction: Hammer.DIRECTION_ALL, threshold: 30, velocity: 0.6 });

    // Long-press
    const press = new Hammer.Press({ event: 'longpress', time: 500, pointers: 1 });

    // Pinch (2-finger squeeze / spread)
    const pinch = new Hammer.Pinch({ event: 'pinch', pointers: 2, threshold: 0.1 });

    // Rotate (2-finger twist)
    const rotate = new Hammer.Rotate({ event: 'rotate', pointers: 2, threshold: 15 });

    // Taps
    const tripletap = new Hammer.Tap({ event: 'tripletap', taps: 3, interval: 300, posThreshold: 24 });
    const doubletap = new Hammer.Tap({ event: 'doubletap', taps: 2, interval: 300, posThreshold: 24 });

    // Add recognizers (order matters — multi-finger first)
    this.manager.add([swipe3, swipe2, pan1, flick1, press, pinch, rotate, tripletap, doubletap]);

    // Relationships: tripletap requires doubletap to fail first
    tripletap.recognizeWith(doubletap);
    doubletap.requireFailure(tripletap);

    // flick1 and pan1 can coexist — we use the intercepting flag to prevent double-fire
    flick1.recognizeWith(pan1);

    // pan1 grabs curRecognizer when the first finger moves.  Multi-finger
    // recognizers must be allowed to run simultaneously, otherwise Hammer's
    // curRecognizer lock resets them before the second finger arrives.
    pan1.recognizeWith([swipe2, swipe3, pinch, rotate]);

    // Pinch and rotate can coexist with each other and with 2-finger swipe
    pinch.recognizeWith([rotate, swipe2]);
    rotate.recognizeWith([pinch, swipe2]);

    // --- Event handlers ---

    // 2-finger swipe (Pan: start/move/end)
    this.manager.on('swipe2start', () => this.handleSwipeStart(2));
    this.manager.on('swipe2move', (e) => this.handleSwipeMove(2, e));
    this.manager.on('swipe2end', (e) => this.handleSwipeEnd(2, e));
    this.manager.on('swipe2cancel', () => this.handleSwipeCancel(2));

    // 3-finger swipe (Pan: start/move/end)
    this.manager.on('swipe3start', () => this.handleSwipeStart(3));
    this.manager.on('swipe3move', (e) => this.handleSwipeMove(3, e));
    this.manager.on('swipe3end', (e) => this.handleSwipeEnd(3, e));
    this.manager.on('swipe3cancel', () => this.handleSwipeCancel(3));

    // 1-finger pan (for swipe-1 direction tracking, continuous scroll, and flick double-fire prevention)
    this.manager.on('pan1start', (e) => this.handlePanStart(e));
    this.manager.on('pan1move', (e) => this.handleSwipeMove(1, e));
    this.manager.on('pan1end', (e) => this.handlePanEnd(e));
    this.manager.on('pan1cancel', () => this.handlePanCancel());

    // 1-finger flick
    this.manager.on('flick1', (e) => this.handleFlick(e));

    // Taps
    this.manager.on('doubletap', () => this.handleDoubleTap());
    this.manager.on('tripletap', (e) => this.handleTripleTap(e));

    // Long-press
    this.manager.on('longpress', (e) => this.handleLongPress(e));

    // Pinch — fire once at end based on final scale
    this.manager.on('pinchend', (e) => this.handlePinchEnd(e));

    // Rotate — fire once at end based on cumulative rotation
    this.manager.on('rotateend', (e) => this.handleRotateEnd(e));

    // --- Capture-phase touch gatekeeper ---
    // Registered on the .xterm element in the capture phase so they fire BEFORE
    // xterm's bubble-phase touch handlers. When gestures are mapped for the
    // current finger count, we block the touch event from reaching xterm entirely.

    this.onCaptureTouchMove = (e: TouchEvent) => {
      if (this.shouldBlockTouch(e.touches.length)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.didIntercept = true;
      }
    };

    this.onCaptureTouchEnd = (e: TouchEvent) => {
      if (this.didIntercept) {
        e.preventDefault(); // suppress synthetic mousedown → xterm focus → keyboard
      }
      if (e.touches.length === 0) {
        this.didIntercept = false;
      }
    };

    element.addEventListener('touchmove', this.onCaptureTouchMove, { capture: true, passive: false });
    element.addEventListener('touchend', this.onCaptureTouchEnd, { capture: true, passive: false });

    this.applyViewportTouchAction();
  }

  updateMapping(mapping: GestureMapping): void {
    this.mapping = mapping;
    this.applyViewportTouchAction();
  }

  updateContinuousScrollGestures(gestures: ReadonlySet<string>): void {
    this.continuousScrollGestures = gestures;
  }

  dispose(): void {
    this.element.removeEventListener('touchmove', this.onCaptureTouchMove, { capture: true });
    this.element.removeEventListener('touchend', this.onCaptureTouchEnd, { capture: true });
    if (this.viewport) this.viewport.style.touchAction = '';
    this.manager.destroy();
  }

  // --- Handlers ---

  // --- Unified swipe handlers (continuous scroll or discrete action) ---

  private handleSwipeStart(fingers: number): void {
    this.swipeLastDeltaY[fingers] = 0;
    this.swipeDidContinuousScroll[fingers] = false;
  }

  private handleSwipeMove(fingers: number, e: HammerInput): void {
    if (this.continuousScrollGestures.size === 0) return;
    if (!this.callbacks.onContinuousScroll) return;

    const incrementalDeltaY = e.deltaY - (this.swipeLastDeltaY[fingers] ?? 0);
    this.swipeLastDeltaY[fingers] = e.deltaY;
    if (incrementalDeltaY === 0) return;

    // Hammer deltaY: negative = fingers moved up. For gesture ID matching,
    // fingers-up = swipe-up. For WheelEvent, negate: fingers-up should produce
    // positive deltaY (scroll down / natural scrolling).
    const gestureId = `swipe-${fingers}-${incrementalDeltaY < 0 ? 'up' : 'down'}` as GestureId;
    if (!this.continuousScrollGestures.has(gestureId)) return;

    this.swipeDidContinuousScroll[fingers] = true;
    this.callbacks.onContinuousScroll(-incrementalDeltaY);
  }

  private handleSwipeEnd(fingers: number, e: HammerInput): void {
    if (this.swipeDidContinuousScroll[fingers]) return;

    // Discrete: determine direction and fire gesture (same as old swipe behavior)
    const dir = hammerDirectionToGesture(e.direction);
    if (!dir) return;
    const gestureId = `swipe-${fingers}-${dir}` as GestureId;
    if (this.mapping[gestureId]) {
      this.callbacks.onGesture(gestureId);
    }
  }

  private handleSwipeCancel(fingers: number): void {
    this.swipeLastDeltaY[fingers] = 0;
    this.swipeDidContinuousScroll[fingers] = false;
  }

  // --- 1-finger pan (swipe-1 direction tracking + flick double-fire prevention) ---

  private handlePanStart(e: HammerInput): void {
    this.handleSwipeStart(1);
    const dir = hammerDirectionToGesture(e.direction);
    if (!dir) return;
    const swipeId = `swipe-1-${dir}` as GestureId;
    const flickId = `flick-1-${dir}` as GestureId;
    if (this.mapping[swipeId] || this.mapping[flickId]) {
      this.intercepting = true;
      this.interceptDirection = dir;
    }
  }

  private handlePanEnd(e: HammerInput): void {
    if (this.intercepting) {
      // If continuous scroll handled it, skip the discrete event
      if (!this.swipeDidContinuousScroll[1]) {
        const dir = hammerDirectionToGesture(e.direction) ?? this.interceptDirection;
        if (dir) {
          const gestureId = `swipe-1-${dir}` as GestureId;
          if (this.mapping[gestureId]) {
            this.callbacks.onGesture(gestureId);
          }
        }
      }
      this.intercepting = false;
      this.interceptDirection = undefined;
    }
  }

  private handlePanCancel(): void {
    this.intercepting = false;
    this.interceptDirection = undefined;
    this.handleSwipeCancel(1);
  }

  private handleFlick(e: HammerInput): void {
    // Don't fire flick if pan1 already intercepted this gesture as a swipe-1
    if (this.intercepting) return;

    const dir = hammerDirectionToGesture(e.direction);
    if (!dir) return;
    const gestureId = `flick-1-${dir}` as GestureId;
    if (this.mapping[gestureId]) {
      this.callbacks.onGesture(gestureId);
    }
  }

  private handleDoubleTap(): void {
    if (this.mapping['double-tap']) {
      this.callbacks.onGesture('double-tap');
    }
  }

  private handleTripleTap(e: HammerInput): void {
    if (this.mapping['triple-tap']) {
      this.callbacks.onGesture('triple-tap');
    } else {
      this.callbacks.onTripleTapDefault(e.center.x, e.center.y);
    }
  }

  private handleLongPress(e: HammerInput): void {
    if (this.mapping['long-press']) {
      this.callbacks.onGesture('long-press');
    } else {
      this.callbacks.onLongPressDefault(e.center.x, e.center.y);
    }
  }

  private handlePinchEnd(e: HammerInput): void {
    // scale < 1 = pinch in (fingers moved together), scale > 1 = pinch out (spread)
    const gestureId: GestureId = e.scale < 1 ? 'pinch-in' : 'pinch-out';
    if (this.mapping[gestureId]) {
      this.callbacks.onGesture(gestureId);
    }
  }

  private handleRotateEnd(e: HammerInput): void {
    // rotation > 0 = clockwise, rotation < 0 = counter-clockwise
    const gestureId: GestureId = e.rotation > 0 ? 'rotate-cw' : 'rotate-ccw';
    if (this.mapping[gestureId]) {
      this.callbacks.onGesture(gestureId);
    }
  }

  // --- Touch gatekeeper helpers ---

  /** Returns true if touch events should be blocked for the given finger count. */
  private shouldBlockTouch(touchCount: number): boolean {
    if (touchCount === 1) {
      return !!(this.mapping['swipe-1-up'] || this.mapping['swipe-1-down'] ||
                this.mapping['swipe-1-left'] || this.mapping['swipe-1-right'] ||
                this.mapping['flick-1-up'] || this.mapping['flick-1-down'] ||
                this.mapping['flick-1-left'] || this.mapping['flick-1-right']);
    }
    if (touchCount === 2) {
      return !!(this.mapping['swipe-2-up'] || this.mapping['swipe-2-down'] ||
                this.mapping['swipe-2-left'] || this.mapping['swipe-2-right'] ||
                this.mapping['pinch-in'] || this.mapping['pinch-out'] ||
                this.mapping['rotate-cw'] || this.mapping['rotate-ccw']);
    }
    if (touchCount === 3) {
      return !!(this.mapping['swipe-3-up'] || this.mapping['swipe-3-down'] ||
                this.mapping['swipe-3-left'] || this.mapping['swipe-3-right']);
    }
    return false;
  }

  private hasVerticalGesture(): boolean {
    return !!(this.mapping['swipe-1-up'] || this.mapping['swipe-1-down'] ||
              this.mapping['flick-1-up'] || this.mapping['flick-1-down'] ||
              this.mapping['swipe-2-up'] || this.mapping['swipe-2-down']);
  }

  /** Set touch-action on xterm's viewport to prevent native touch scroll. */
  private applyViewportTouchAction(): void {
    if (!this.viewport) return;
    const v = this.hasVerticalGesture();
    const h = !!(this.mapping['swipe-1-left'] || this.mapping['swipe-1-right'] ||
                 this.mapping['flick-1-left'] || this.mapping['flick-1-right']);
    if (v && h) this.viewport.style.touchAction = 'none';
    else if (v) this.viewport.style.touchAction = 'pan-x';
    else if (h) this.viewport.style.touchAction = 'pan-y';
    else this.viewport.style.touchAction = '';
  }
}
