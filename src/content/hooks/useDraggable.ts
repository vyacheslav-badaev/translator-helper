/**
 * useDraggable — Generic pointer-based drag hook with boundary clamping.
 *
 * Used by `TranslationPanel` for both the floating panel and the status badge.
 * Accepts a clamping function that constrains the position within the viewport.
 * Uses pointer capture for smooth cross-element dragging.
 */

import React, { useState, useRef, useCallback } from 'react';

/** Screen coordinates. */
type Position = { x: number; y: number };

/** A function that constrains raw (x, y) to valid viewport bounds. */
type ClampFn = (x: number, y: number) => Position;

export interface UseDraggableReturn {
  pos: Position;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
}

/**
 * @param initialPos - Lazy initializer for the starting position.
 * @param clampFn    - Constrains the dragged position within viewport bounds.
 */
export function useDraggable(
  initialPos: () => Position,
  clampFn: ClampFn
): UseDraggableReturn {
  const [pos, setPos] = useState<Position>(initialPos);
  const isDragging = useRef(false);
  const dragStart = useRef<Position>({ x: 0, y: 0 });

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      isDragging.current = true;
      dragStart.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos]
  );

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDragging.current) return;
      const rawX = e.clientX - dragStart.current.x;
      const rawY = e.clientY - dragStart.current.y;
      setPos(clampFn(rawX, rawY));
    },
    [clampFn]
  );

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    isDragging.current = false;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  return { pos, onPointerDown, onPointerMove, onPointerUp };
}
