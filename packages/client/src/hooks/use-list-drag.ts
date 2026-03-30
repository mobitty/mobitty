// Hook for pointer-based drag-to-reorder in a vertical list.
// Attach handleProps(index) to each item's drag handle.

import { useState, useRef, useCallback } from 'react';

interface DragState {
  fromIndex: number;
  startY: number;
  rowHeight: number;
}

interface UseListDragOptions {
  itemCount: number;
  onReorder: (fromIndex: number, toIndex: number) => void;
}

interface UseListDragResult {
  dragIndex: number | null;
  dropIndex: number | null;
  handleProps: (index: number) => {
    onPointerDown: (e: React.PointerEvent) => void;
  };
}

export function useListDrag({ itemCount, onReorder }: UseListDragOptions): UseListDragResult {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dy = e.clientY - d.startY;
    const offset = Math.round(dy / d.rowHeight);
    const target = Math.max(0, Math.min(itemCountRef.current - 1, d.fromIndex + offset));
    setDropIndex(target);
  }, []);

  const onPointerUp = useCallback((e: PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    (e.target as Element).releasePointerCapture(e.pointerId);
    document.removeEventListener('pointermove', onPointerMove);
    document.removeEventListener('pointerup', onPointerUp);

    if (d) {
      const dy = e.clientY - d.startY;
      const offset = Math.round(dy / d.rowHeight);
      const target = Math.max(0, Math.min(itemCountRef.current - 1, d.fromIndex + offset));
      if (target !== d.fromIndex) {
        onReorderRef.current(d.fromIndex, target);
      }
    }
    setDragIndex(null);
    setDropIndex(null);
  }, [onPointerMove]);

  const handleProps = useCallback((index: number) => ({
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // Measure row height from the handle's closest list-item parent
      const row = (e.target as HTMLElement).closest('[data-drag-item]');
      const rowHeight = row ? row.getBoundingClientRect().height + 8 : 52; // 8 = gap estimate
      dragRef.current = { fromIndex: index, startY: e.clientY, rowHeight };
      setDragIndex(index);
      setDropIndex(index);
      (e.target as Element).setPointerCapture(e.pointerId);
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    },
  }), [onPointerMove, onPointerUp]);

  return { dragIndex, dropIndex, handleProps };
}
