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
type ClampFn = (posX: number, posY: number) => Position;

export interface UseDraggableReturn {
  pos: Position;
  onPointerDown: (event: React.PointerEvent) => void;
  onPointerMove: (event: React.PointerEvent) => void;
  onPointerUp: (event: React.PointerEvent) => void;
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
    (event: React.PointerEvent) => {
      isDragging.current = true;
      dragStart.current = { x: event.clientX - pos.x, y: event.clientY - pos.y };
      (event.target as HTMLElement).setPointerCapture(event.pointerId);
    },
    [pos]
  );

  const onPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!isDragging.current) return;
      const rawX = event.clientX - dragStart.current.x;
      const rawY = event.clientY - dragStart.current.y;
      setPos(clampFn(rawX, rawY));
    },
    [clampFn]
  );

  const onPointerUp = useCallback((event: React.PointerEvent) => {
    isDragging.current = false;
    (event.target as HTMLElement).releasePointerCapture(event.pointerId);
  }, []);

  return { pos, onPointerDown, onPointerMove, onPointerUp };
}
