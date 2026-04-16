// Pointer-event gesture recognizers for touch gesture detection.
// Maps pointer events to GestureId values and handles xterm.js integration.
//
// Architecture: two independent event channels prevent conflicts with xterm.js.
//   Pointer events → gesture recognizers → gesture callbacks
//   Touch events   → capture-phase gatekeeper   → block or pass to xterm
// xterm only listens to touch events (no pointer listeners), so pointer-based
// detection is completely invisible to xterm.  The gatekeeper uses
// stopImmediatePropagation in the capture phase to prevent xterm's bubble-phase
// touchmove handler from firing when gestures are active.

import type { GestureId, GestureMapping, GestureDirection } from './gesture-types';

export interface GestureDetectorCallbacks {
  onGesture: (gestureId: GestureId, center: { x: number; y: number }) => void;
  onContinuousScroll?: (deltaY: number) => void;
  onLongPressDefault: (clientX: number, clientY: number) => void;
}

// --- Internal types ---

interface PointerState {
  readonly id: number;
  readonly startX: number;
  readonly startY: number;
  readonly startTime: number;
  x: number;
  y: number;
}

interface Point {
  readonly x: number;
  readonly y: number;
}

type Phase = 'idle' | 'pending' | 'tracking' | 'tap-wait';

// --- Constants ---

const PAN_THRESHOLD_1 = 30;
const PAN_THRESHOLD_MULTI = 10;
const FLICK_VELOCITY = 0.6;      // px/ms — matches Hammer Swipe velocity option
const LONG_PRESS_TIME = 500;
const LONG_PRESS_MOVE = 10;
const TAP_MAX_TIME = 250;         // max hold duration per tap (Hammer default)
const TAP_MAX_MOVE = 9;           // max movement during a tap (Hammer default)
const TAP_INTERVAL = 300;         // max time between consecutive taps
const TAP_POS_THRESHOLD = 24;     // max distance between multi-tap positions
const PINCH_THRESHOLD = 0.1;      // |scale - 1|
const ROTATE_THRESHOLD = 15;      // degrees

// --- Helpers ---

function computeCentroid(pointers: Map<number, PointerState>): Point {
  let sx = 0;
  let sy = 0;
  for (const p of pointers.values()) {
    sx += p.x;
    sy += p.y;
  }
  const n = pointers.size;
  return { x: sx / n, y: sy / n };
}

function distance(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.sqrt(dx * dx + dy * dy);
}

function angle(p1: PointerState, p2: PointerState): number {
  return Math.atan2(p2.y - p1.y, p2.x - p1.x) * (180 / Math.PI);
}

function dominantDirection(dx: number, dy: number): GestureDirection | undefined {
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx > 0 ? 'right' : 'left';
  }
  return dy > 0 ? 'down' : 'up';
}

function getTwoPointers(pointers: Map<number, PointerState>): readonly [PointerState, PointerState] | undefined {
  if (pointers.size < 2) return undefined;
  const iter = pointers.values();
  const a = iter.next().value;
  const b = iter.next().value;
  if (!a || !b) return undefined;
  return [a, b];
}

// --- GestureDetector ---

export class GestureDetector {
  private mapping: GestureMapping;
  private callbacks: GestureDetectorCallbacks;
  private continuousScrollGestures: ReadonlySet<string>;
  private element: HTMLElement;
  private viewport: HTMLElement | null;

  // Pointer tracking
  private pointers = new Map<number, PointerState>();
  private phase: Phase = 'idle';
  private gestureStartTime = 0;

  // Pan state
  private panFingerCount = 0;
  private panStartCentroid: Point = { x: 0, y: 0 };
  private lastCentroid: Point = { x: 0, y: 0 };
  private swipeDidContinuousScroll = false;

  // 1-finger intercept (flick/pan coexistence)
  private intercepting = false;
  private interceptDirection: GestureDirection | undefined;

  // 2-finger state (pinch + rotate)
  private initialPinchDist = 0;
  private initialRotateAngle = 0;
  private currentScale = 1;
  private currentRotation = 0;

  // Tap state
  private tapCount = 0;
  private tapTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTapX = 0;
  private lastTapY = 0;

  // Long press
  private longPressTimer: ReturnType<typeof setTimeout> | undefined;
  private longPressPointer: PointerState | undefined;

  // Capture-phase touch gatekeeper: blocks touch events from reaching xterm's
  // bubble-phase handlers when gestures are mapped for the current finger count.
  private didIntercept = false;
  private didLongPress = false;
  private boundOnCaptureTouchMove: (e: TouchEvent) => void;
  private boundOnCaptureTouchEnd: (e: TouchEvent) => void;

  // Pointer event handlers (bound for removal)
  private boundOnPointerDown: (e: PointerEvent) => void;
  private boundOnPointerMove: (e: PointerEvent) => void;
  private boundOnPointerUp: (e: PointerEvent) => void;
  private boundOnPointerCancel: (e: PointerEvent) => void;

  constructor(element: HTMLElement, mapping: GestureMapping, callbacks: GestureDetectorCallbacks, continuousScrollGestures?: ReadonlySet<string>) {
    this.mapping = mapping;
    this.callbacks = callbacks;
    this.continuousScrollGestures = continuousScrollGestures ?? new Set();
    this.element = element;
    this.viewport = element.querySelector('.xterm-viewport');

    // --- Pointer event listeners ---
    // Pointer events are independent of touch events.  touch-action: none on
    // .xterm * (set in CSS) prevents the browser from firing pointercancel
    // when it would otherwise take over for native scroll/zoom.

    this.boundOnPointerDown = (e) => this.onPointerDown(e);
    this.boundOnPointerMove = (e) => this.onPointerMove(e);
    this.boundOnPointerUp = (e) => this.onPointerUp(e);
    this.boundOnPointerCancel = (e) => this.onPointerCancel(e);

    element.addEventListener('pointerdown', this.boundOnPointerDown);
    element.addEventListener('pointermove', this.boundOnPointerMove);
    element.addEventListener('pointerup', this.boundOnPointerUp);
    element.addEventListener('pointercancel', this.boundOnPointerCancel);

    // --- Capture-phase touch gatekeeper ---
    // Registered in the capture phase so they fire BEFORE xterm's bubble-phase
    // touch handlers. When gestures are mapped for the current finger count, we
    // block the touch event from reaching xterm entirely.

    this.boundOnCaptureTouchMove = (e: TouchEvent) => {
      if (this.shouldBlockTouch(e.touches.length)) {
        e.stopImmediatePropagation();
        e.preventDefault();
        this.didIntercept = true;
      }
    };

    this.boundOnCaptureTouchEnd = (e: TouchEvent) => {
      if (this.didIntercept || this.didLongPress) {
        e.preventDefault(); // suppress synthetic mousedown → xterm focus → keyboard
      }
      if (e.touches.length === 0) {
        this.didIntercept = false;
        this.didLongPress = false;
      }
    };

    element.addEventListener('touchmove', this.boundOnCaptureTouchMove, { capture: true, passive: false });
    element.addEventListener('touchend', this.boundOnCaptureTouchEnd, { capture: true, passive: false });

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
    this.element.removeEventListener('pointerdown', this.boundOnPointerDown);
    this.element.removeEventListener('pointermove', this.boundOnPointerMove);
    this.element.removeEventListener('pointerup', this.boundOnPointerUp);
    this.element.removeEventListener('pointercancel', this.boundOnPointerCancel);
    this.element.removeEventListener('touchmove', this.boundOnCaptureTouchMove, { capture: true });
    this.element.removeEventListener('touchend', this.boundOnCaptureTouchEnd, { capture: true });
    if (this.viewport) this.viewport.style.touchAction = '';
    this.clearLongPress();
    this.clearTapTimer();
    this.pointers.clear();
    this.phase = 'idle';
  }

  // --- Pointer event handlers ---

  private onPointerDown(e: PointerEvent): void {
    const now = performance.now();
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      startTime: now,
      x: e.clientX,
      y: e.clientY,
    });

    if (this.phase === 'idle' || this.phase === 'tap-wait') {
      // Keep tapCount when coming from tap-wait (multi-tap sequence in progress)
      if (this.phase === 'tap-wait') {
        this.clearTapTimer();
      }
      this.phase = 'pending';
      this.gestureStartTime = now;
      this.panStartCentroid = computeCentroid(this.pointers);
      this.lastCentroid = this.panStartCentroid;

      if (this.pointers.size === 1) {
        this.startLongPress(e.clientX, e.clientY);
      }
    } else if (this.phase === 'pending') {
      // Additional finger arrived — reset start centroid so threshold is
      // measured from when all current fingers are down
      this.clearLongPress();
      this.panStartCentroid = computeCentroid(this.pointers);
      this.lastCentroid = this.panStartCentroid;
    } else if (this.phase === 'tracking') {
      // Finger count upgrade during active pan
      this.panFingerCount = this.pointers.size;
      this.lastCentroid = computeCentroid(this.pointers);
      this.swipeDidContinuousScroll = false;
    }

    // Record 2-finger baseline (pinch distance + rotate angle)
    if (this.pointers.size === 2) {
      this.initTwoFingerState();
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;

    ptr.x = e.clientX;
    ptr.y = e.clientY;

    if (this.phase === 'pending') {
      this.handlePendingMove();
    } else if (this.phase === 'tracking') {
      this.handleTrackingMove();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const ptr = this.pointers.get(e.pointerId);
    if (!ptr) return;

    ptr.x = e.clientX;
    ptr.y = e.clientY;

    // Compute final centroid BEFORE removing the pointer
    const finalCentroid = computeCentroid(this.pointers);
    const now = performance.now();

    this.pointers.delete(e.pointerId);

    if (this.phase === 'tracking') {
      if (this.pointers.size === 0) {
        this.finishTracking(finalCentroid, now);
      } else {
        // Finger lifted but others remain — reset centroid baseline to prevent jump
        this.lastCentroid = computeCentroid(this.pointers);
      }
    } else if (this.phase === 'pending') {
      this.clearLongPress();
      if (this.pointers.size === 0) {
        this.handlePotentialTap(ptr, now);
      }
    }
  }

  private onPointerCancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) {
      this.resetToIdle();
    } else if (this.phase === 'pending') {
      this.panStartCentroid = computeCentroid(this.pointers);
      this.lastCentroid = this.panStartCentroid;
    } else if (this.phase === 'tracking') {
      this.lastCentroid = computeCentroid(this.pointers);
    }
  }

  // --- Pending phase: detect threshold crossing ---

  private handlePendingMove(): void {
    const c = computeCentroid(this.pointers);
    const displacement = distance(this.panStartCentroid.x, this.panStartCentroid.y, c.x, c.y);

    // Cancel long press if finger moved too far
    if (this.longPressPointer && displacement > LONG_PRESS_MOVE) {
      this.clearLongPress();
    }

    const threshold = this.pointers.size === 1 ? PAN_THRESHOLD_1 : PAN_THRESHOLD_MULTI;
    if (displacement >= threshold) {
      this.activateTracking(c);
    }
  }

  private activateTracking(currentCentroid: Point): void {
    this.clearLongPress();
    this.tapCount = 0; // pan activation cancels pending tap sequence
    this.phase = 'tracking';
    this.panFingerCount = this.pointers.size;
    this.lastCentroid = currentCentroid;
    this.swipeDidContinuousScroll = false;

    // 1-finger: set intercepting if swipe-1 or flick-1 is mapped for
    // the initial direction (prevents flick from also firing at gesture end)
    this.intercepting = false;
    this.interceptDirection = undefined;
    if (this.panFingerCount === 1) {
      const dx = currentCentroid.x - this.panStartCentroid.x;
      const dy = currentCentroid.y - this.panStartCentroid.y;
      const dir = dominantDirection(dx, dy);
      if (dir) {
        const swipeId = `swipe-1-${dir}` as GestureId;
        const flickId = `flick-1-${dir}` as GestureId;
        if (this.mapping[swipeId] || this.mapping[flickId]) {
          this.intercepting = true;
          this.interceptDirection = dir;
        }
      }
    }

    // Record 2-finger baseline if activating with 2 fingers
    if (this.pointers.size === 2) {
      this.initTwoFingerState();
    }
  }

  // --- Tracking phase: continuous movement ---

  private handleTrackingMove(): void {
    const c = computeCentroid(this.pointers);

    // Continuous scroll — forward incremental deltaY when the gesture maps
    // to a wheel-step action
    if (this.continuousScrollGestures.size > 0 && this.callbacks.onContinuousScroll) {
      const incrementalDeltaY = c.y - this.lastCentroid.y;
      if (incrementalDeltaY !== 0) {
        // Centroid Y decreasing = fingers moved up = swipe-up gesture.
        // For WheelEvent: negate so fingers-up produces positive deltaY
        // (scroll down / natural scrolling).
        const gestureId = `swipe-${this.panFingerCount}-${incrementalDeltaY < 0 ? 'up' : 'down'}` as GestureId;
        if (this.continuousScrollGestures.has(gestureId)) {
          this.swipeDidContinuousScroll = true;
          this.callbacks.onContinuousScroll(-incrementalDeltaY);
        }
      }
    }

    // 2-finger: track pinch scale and rotation
    if (this.pointers.size === 2 && this.initialPinchDist > 0) {
      const pair = getTwoPointers(this.pointers);
      if (pair) {
        const [a, b] = pair;
        this.currentScale = distance(a.x, a.y, b.x, b.y) / this.initialPinchDist;
        let rotation = angle(a, b) - this.initialRotateAngle;
        if (rotation > 180) rotation -= 360;
        if (rotation < -180) rotation += 360;
        this.currentRotation = rotation;
      }
    }

    this.lastCentroid = c;
  }

  // --- Tracking end: fire discrete gestures ---

  private finishTracking(finalCentroid: Point, now: number): void {
    const fingers = this.panFingerCount;

    if (!this.swipeDidContinuousScroll) {
      if (fingers === 1) {
        this.finish1FingerTracking(finalCentroid, now);
      } else {
        const dx = finalCentroid.x - this.panStartCentroid.x;
        const dy = finalCentroid.y - this.panStartCentroid.y;
        const dir = dominantDirection(dx, dy);
        if (dir) {
          const gestureId = `swipe-${fingers}-${dir}` as GestureId;
          if (this.mapping[gestureId]) {
            this.callbacks.onGesture(gestureId, finalCentroid);
          }
        }
      }
    }

    // Pinch — fire once at end based on final scale (2-finger only)
    if (fingers === 2 && Math.abs(this.currentScale - 1) > PINCH_THRESHOLD) {
      const gestureId: GestureId = this.currentScale < 1 ? 'pinch-in' : 'pinch-out';
      if (this.mapping[gestureId]) {
        this.callbacks.onGesture(gestureId, finalCentroid);
      }
    }

    // Rotate — fire once at end based on cumulative rotation (2-finger only)
    if (fingers === 2 && Math.abs(this.currentRotation) > ROTATE_THRESHOLD) {
      const gestureId: GestureId = this.currentRotation > 0 ? 'rotate-cw' : 'rotate-ccw';
      if (this.mapping[gestureId]) {
        this.callbacks.onGesture(gestureId, finalCentroid);
      }
    }

    this.resetToIdle();
  }

  private finish1FingerTracking(finalCentroid: Point, now: number): void {
    // Pan end: fire swipe-1 if intercepting and mapped.  Uses final direction
    // (total displacement) with fallback to the initial intercept direction.
    if (this.intercepting) {
      const dx = finalCentroid.x - this.panStartCentroid.x;
      const dy = finalCentroid.y - this.panStartCentroid.y;
      const dir = dominantDirection(dx, dy) ?? this.interceptDirection;
      if (dir) {
        const gestureId = `swipe-1-${dir}` as GestureId;
        if (this.mapping[gestureId]) {
          this.callbacks.onGesture(gestureId, finalCentroid);
        }
      }
      this.intercepting = false;
      this.interceptDirection = undefined;
    }

    // Flick: velocity-based, fires after pan end.  In the Hammer-based code,
    // the Swipe recognizer ran after the Pan recognizer in the same input cycle,
    // so intercepting was already reset — flick could fire independently.
    // We preserve this: pan resets intercepting above, then flick checks below.
    const dt = now - this.gestureStartTime;
    if (dt > 0) {
      const dx = finalCentroid.x - this.panStartCentroid.x;
      const dy = finalCentroid.y - this.panStartCentroid.y;
      const speed = Math.max(Math.abs(dx / dt), Math.abs(dy / dt));
      if (speed >= FLICK_VELOCITY) {
        const dir = dominantDirection(dx, dy);
        if (dir) {
          const gestureId = `flick-1-${dir}` as GestureId;
          if (this.mapping[gestureId]) {
            this.callbacks.onGesture(gestureId, finalCentroid);
          }
        }
      }
    }
  }

  // --- Tap detection ---

  private handlePotentialTap(ptr: PointerState, now: number): void {
    const holdTime = now - ptr.startTime;
    const movement = distance(ptr.startX, ptr.startY, ptr.x, ptr.y);

    if (holdTime > TAP_MAX_TIME || movement > TAP_MAX_MOVE) {
      // Too long or too much movement — not a tap
      this.tapCount = 0;
      this.phase = 'idle';
      return;
    }

    // Multi-tap: check position proximity to previous tap
    if (this.tapCount > 0) {
      const tapDist = distance(this.lastTapX, this.lastTapY, ptr.x, ptr.y);
      if (tapDist > TAP_POS_THRESHOLD) {
        // Too far — resolve existing taps and start a fresh sequence
        this.resolveTaps();
      }
    }

    this.tapCount++;
    this.lastTapX = ptr.x;
    this.lastTapY = ptr.y;

    // Wait for additional taps.  The timer naturally handles triple-tap
    // priority: 3 taps within the window resolve as triple-tap, not
    // double-tap.  This replaces Hammer's requireFailure(tripletap).
    this.clearTapTimer();
    this.tapTimer = setTimeout(() => this.resolveTaps(), TAP_INTERVAL);
    this.phase = 'tap-wait';
  }

  private resolveTaps(): void {
    const count = this.tapCount;
    this.tapCount = 0;
    this.clearTapTimer();
    this.phase = 'idle';

    const center = { x: this.lastTapX, y: this.lastTapY };
    if (count >= 3 && this.mapping['triple-tap']) {
      this.callbacks.onGesture('triple-tap', center);
    } else if (count >= 2 && this.mapping['double-tap']) {
      this.callbacks.onGesture('double-tap', center);
    }
  }

  // --- Long press ---

  private startLongPress(x: number, y: number): void {
    this.clearLongPress();
    const first = this.pointers.values().next().value;
    if (!first) return;
    this.longPressPointer = first;
    this.longPressTimer = setTimeout(() => {
      this.didLongPress = true;
      this.callbacks.onLongPressDefault(x, y);
      this.longPressTimer = undefined;
      this.longPressPointer = undefined;
    }, LONG_PRESS_TIME);
  }

  private clearLongPress(): void {
    if (this.longPressTimer !== undefined) {
      clearTimeout(this.longPressTimer);
      this.longPressTimer = undefined;
    }
    this.longPressPointer = undefined;
  }

  // --- 2-finger state ---

  private initTwoFingerState(): void {
    const pair = getTwoPointers(this.pointers);
    if (!pair) return;
    const [a, b] = pair;
    this.initialPinchDist = distance(a.x, a.y, b.x, b.y);
    this.initialRotateAngle = angle(a, b);
    this.currentScale = 1;
    this.currentRotation = 0;
  }

  // --- Reset ---

  private resetToIdle(): void {
    this.phase = 'idle';
    this.intercepting = false;
    this.interceptDirection = undefined;
    this.swipeDidContinuousScroll = false;
    this.panFingerCount = 0;
    this.initialPinchDist = 0;
    this.currentScale = 1;
    this.currentRotation = 0;
    this.clearLongPress();
    this.pointers.clear();
  }

  private clearTapTimer(): void {
    if (this.tapTimer !== undefined) {
      clearTimeout(this.tapTimer);
      this.tapTimer = undefined;
    }
  }

  // --- Touch gatekeeper helpers (unchanged — no pointer-event dependency) ---

  private shouldBlockTouch(touchCount: number): boolean {
    if (touchCount === 1) {
      return !!(this.mapping['swipe-1-left'] || this.mapping['swipe-1-right'] ||
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
    return !!(this.mapping['flick-1-up'] || this.mapping['flick-1-down'] ||
              this.mapping['swipe-2-up'] || this.mapping['swipe-2-down']);
  }

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
