// Hook for Outlook-style horizontal swipe-to-reveal actions on a list row.
//
// Behavior:
//   - Track horizontal pointer movement; bail to native vertical scroll if the
//     gesture is more vertical than horizontal early on.
//   - On release:
//       |dx| < OPEN_THRESHOLD            → snap back to 0 (closed)
//       OPEN_THRESHOLD ≤ |dx| < INVOKE   → snap to ±OPEN_OFFSET (revealed)
//       |dx| ≥ INVOKE_THRESHOLD          → invoke the action, snap back to 0
//   - "Open" state is reflected to the parent via `isOpen`/`onOpenChange` so
//     the parent can enforce one-row-open-at-a-time.

import { useEffect, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent } from 'react';

const SCROLL_BAIL_PX = 8;          // vertical movement before we lose to the scroller
const HORIZONTAL_LOCK_PX = 6;      // horizontal movement that locks us as a swipe
const OPEN_THRESHOLD = 60;         // |dx| at release to snap revealed instead of closed
const OPEN_OFFSET = 112;           // resting reveal width when "open" — fits "Rename"/"Delete" + icon + padding
const INVOKE_THRESHOLD = 160;      // |dx| at release to auto-invoke the action
const POST_SWIPE_CLICK_GUARD_MS = 300;

export type SwipeOpenSide = 'left' | 'right' | null;

export interface UseSwipeActionsOptions {
  disabled?: boolean;
  /** Called when swipe ends past INVOKE_THRESHOLD to the right (left-side action). */
  onRightAction?: () => void;
  /** Called when swipe ends past INVOKE_THRESHOLD to the left (right-side action). */
  onLeftAction?: () => void;
  /** Externally-controlled open side. When this changes to a different value, the row snaps. */
  openSide: SwipeOpenSide;
  /** Notify parent when this row settles into / out of an open state. */
  onOpenChange: (side: SwipeOpenSide) => void;
}

export interface UseSwipeActionsResult {
  /** Pixel offset to apply via transform: translateX(...). Positive = revealed-left. */
  deltaX: number;
  /** 0..1 saturation, hits 1 at the resting open offset. Drives action color/opacity. */
  progress: number;
  /** True while finger is down — caller should disable CSS transitions for 1:1 tracking. */
  isDragging: boolean;
  /** Returns true if a click occurred too soon after a swipe and should be suppressed. */
  shouldSuppressClick: () => boolean;
  handlers: {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
  };
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  baseDelta: number;
  locked: boolean;
  bailed: boolean;
}

export function useSwipeActions({
  disabled,
  onRightAction,
  onLeftAction,
  openSide,
  onOpenChange,
}: UseSwipeActionsOptions): UseSwipeActionsResult {
  const [deltaX, setDeltaX] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<DragState | null>(null);
  const lastSwipeEndRef = useRef(0);

  // Snap to whatever openSide says we should be at, when we're not actively dragging.
  useEffect(() => {
    if (dragRef.current) return;
    if (openSide === 'left') setDeltaX(OPEN_OFFSET);
    else if (openSide === 'right') setDeltaX(-OPEN_OFFSET);
    else setDeltaX(0);
  }, [openSide]);

  const finish = useCallback((finalDelta: number) => {
    let invoked: 'left' | 'right' | null = null;
    let nextSide: SwipeOpenSide = null;

    if (finalDelta >= INVOKE_THRESHOLD) {
      invoked = 'right';
    } else if (finalDelta <= -INVOKE_THRESHOLD) {
      invoked = 'left';
    } else if (finalDelta >= OPEN_THRESHOLD) {
      nextSide = 'left';
    } else if (finalDelta <= -OPEN_THRESHOLD) {
      nextSide = 'right';
    }

    setIsDragging(false);
    dragRef.current = null;
    lastSwipeEndRef.current = Date.now();

    if (invoked === 'right') {
      setDeltaX(0);
      onOpenChange(null);
      onRightAction?.();
    } else if (invoked === 'left') {
      setDeltaX(0);
      onOpenChange(null);
      onLeftAction?.();
    } else if (nextSide !== openSide) {
      onOpenChange(nextSide);
      // useEffect above will animate to the new resting offset
    } else {
      // settle to the existing resting position
      if (nextSide === 'left') setDeltaX(OPEN_OFFSET);
      else if (nextSide === 'right') setDeltaX(-OPEN_OFFSET);
      else setDeltaX(0);
    }
  }, [onOpenChange, onLeftAction, onRightAction, openSide]);

  const onPointerDown = useCallback((e: ReactPointerEvent) => {
    if (disabled) return;
    if (e.pointerType === 'mouse') return; // swipe is touch-only
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseDelta: openSide === 'left' ? OPEN_OFFSET : openSide === 'right' ? -OPEN_OFFSET : 0,
      locked: false,
      bailed: false,
    };
  }, [disabled, openSide]);

  const onPointerMove = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.bailed || d.pointerId !== e.pointerId) return;

    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;

    if (!d.locked) {
      // Decide between scroll (vertical) and swipe (horizontal)
      if (Math.abs(dy) > SCROLL_BAIL_PX && Math.abs(dy) > Math.abs(dx)) {
        d.bailed = true;
        return;
      }
      if (Math.abs(dx) < HORIZONTAL_LOCK_PX) return;
      d.locked = true;
      setIsDragging(true);
      try { (e.currentTarget as Element).setPointerCapture(e.pointerId); } catch { /* no-op */ }
    }

    e.preventDefault();
    setDeltaX(d.baseDelta + dx);
  }, []);

  const onPointerUp = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    if (!d.locked || d.bailed) {
      // No real swipe occurred — treat as ignored
      dragRef.current = null;
      return;
    }
    try { (e.currentTarget as Element).releasePointerCapture(e.pointerId); } catch { /* no-op */ }
    const dx = e.clientX - d.startX;
    finish(d.baseDelta + dx);
  }, [finish]);

  const onPointerCancel = useCallback((e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    setIsDragging(false);
    dragRef.current = null;
    // Restore resting position based on current openSide
    if (openSide === 'left') setDeltaX(OPEN_OFFSET);
    else if (openSide === 'right') setDeltaX(-OPEN_OFFSET);
    else setDeltaX(0);
  }, [openSide]);

  const shouldSuppressClick = useCallback(() => {
    return Date.now() - lastSwipeEndRef.current < POST_SWIPE_CLICK_GUARD_MS;
  }, []);

  const progress = Math.min(Math.abs(deltaX) / OPEN_OFFSET, 1);

  return {
    deltaX,
    progress,
    isDragging,
    shouldSuppressClick,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
  };
}
