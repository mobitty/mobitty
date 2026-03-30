// Hook for pointer-based drag-to-reposition on an absolute-position element.
// Attach handleProps to the drag handle (e.g. a header bar).

import { useState, useRef, useCallback } from 'react';

interface DragState {
  startX: number;
  startY: number;
  startLeft: number;
  startTop: number;
}

interface UseDragResult {
  x: number;
  y: number;
  handleProps: {
    onPointerDown: (e: React.PointerEvent) => void;
  };
}

function viewportWidth(): number {
  return window.visualViewport?.width ?? window.innerWidth;
}

function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

export function useDrag(initialX: number, initialY: number): UseDragResult {
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const dragRef = useRef<DragState | null>(null);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const nx = Math.max(0, Math.min(viewportWidth() - 40, d.startLeft + (e.clientX - d.startX)));
    const ny = Math.max(0, Math.min(viewportHeight() - 40, d.startTop + (e.clientY - d.startY)));
    setPos({ x: nx, y: ny });
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);
  }, [onPointerMove]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = { startX: e.clientX, startY: e.clientY, startLeft: pos.x, startTop: pos.y };
    (e.target as Element).setPointerCapture(e.pointerId);
    document.addEventListener('pointermove', onPointerMove);
    document.addEventListener('pointerup', onPointerUp);
  }, [pos.x, pos.y, onPointerMove, onPointerUp]);

  return { x: pos.x, y: pos.y, handleProps: { onPointerDown } };
}
