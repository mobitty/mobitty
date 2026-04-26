// Hook for tap-vs-long-press button behavior (pointer events).
// Short release fires onPress; holding past delayMs fires onLongPress and
// suppresses the subsequent release. Mirrors usePressRepeat's native-listener
// pattern so preventDefault() is guaranteed non-passive.

import { useRef, useCallback, useEffect, type RefObject } from 'react';

interface UsePressLongPressOptions {
  onPress: () => void;
  onLongPress: () => void;
  delayMs?: number;
}

interface PressHandlers {
  ref: RefObject<HTMLButtonElement | null>;
  onPointerUp: (e: React.PointerEvent) => void;
  onPointerLeave: (e: React.PointerEvent) => void;
  onPointerCancel: (e: React.PointerEvent) => void;
  onClick: (e: React.MouseEvent) => void;
}

export function usePressLongPress({
  onPress,
  onLongPress,
  delayMs = 500,
}: UsePressLongPressOptions): PressHandlers {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const armed = useRef(false);
  const longTriggered = useRef(false);
  const delayTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const delayMsRef = useRef(delayMs);
  delayMsRef.current = delayMs;

  const stopTimer = useCallback(() => {
    if (delayTimer.current !== null) { clearTimeout(delayTimer.current); delayTimer.current = null; }
  }, []);

  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
      armed.current = true;
      longTriggered.current = false;
      stopTimer();
      delayTimer.current = setTimeout(() => {
        longTriggered.current = true;
        onLongPressRef.current();
      }, delayMsRef.current);
    };
    el.addEventListener('pointerdown', handler);
    return () => el.removeEventListener('pointerdown', handler);
  }, [stopTimer]);

  const releasePress = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!armed.current) return;
    armed.current = false;
    const longTrig = longTriggered.current;
    stopTimer();
    longTriggered.current = false;
    if (!longTrig) onPressRef.current();
  }, [stopTimer]);

  const cancelPress = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    armed.current = false;
    stopTimer();
    longTriggered.current = false;
  }, [stopTimer]);

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
