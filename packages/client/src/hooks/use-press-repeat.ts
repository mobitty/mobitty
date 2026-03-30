// Hook for hold-to-repeat button behavior (pointer events).
// Uses a ref-based native pointerdown listener to guarantee non-passive
// preventDefault, since React synthetic events don't make that guarantee.

import { useRef, useCallback, useEffect, type RefObject } from 'react';

interface UsePressRepeatOptions {
  onPress: () => void;
  delayMs?: number;
  intervalMs?: number;
  enabled?: boolean;
}

interface PressHandlers {
  ref: RefObject<HTMLButtonElement | null>;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

export function usePressRepeat({
  onPress,
  delayMs = 300,
  intervalMs = 120,
  enabled = true,
}: UsePressRepeatOptions): PressHandlers {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const armed = useRef(false);
  const holdTriggered = useRef(false);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs for values used inside the native listener.
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const delayMsRef = useRef(delayMs);
  delayMsRef.current = delayMs;
  const intervalMsRef = useRef(intervalMs);
  intervalMsRef.current = intervalMs;

  const stopTimers = useCallback(() => {
    if (delayTimer.current !== null) { clearTimeout(delayTimer.current); delayTimer.current = null; }
    if (intervalTimer.current !== null) { clearInterval(intervalTimer.current); intervalTimer.current = null; }
  }, []);

  // Native pointerdown listener — guaranteed non-passive.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      if (!enabledRef.current) { onPressRef.current(); return; }
      armed.current = true;
      holdTriggered.current = false;
      stopTimers();
      delayTimer.current = setTimeout(() => {
        holdTriggered.current = true;
        onPressRef.current();
        intervalTimer.current = setInterval(() => onPressRef.current(), intervalMsRef.current);
      }, delayMsRef.current);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [stopTimers]);

  const releasePress = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!armed.current) return;
    armed.current = false;
    const triggered = holdTriggered.current;
    stopTimers();
    holdTriggered.current = false;
    if (!triggered) onPress();
  }, [onPress, stopTimers]);

  const cancelPress = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    armed.current = false;
    stopTimers();
    holdTriggered.current = false;
  }, [stopTimers]);

  const onClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
  }, []);

  return {
    ref: buttonRef,
    onPointerUp: releasePress,
    onPointerLeave: cancelPress,
    onPointerCancel: cancelPress,
    onClick,
  };
}
