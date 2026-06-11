import { useRef, useEffect, useCallback } from 'react';

interface SwipeOptions {
  onSwipeRight?: () => void;
  onSwipeLeft?: () => void;
  threshold?: number;
}

interface TouchState {
  startX: number;
  startY: number;
  startTime: number;
}

export function useMobileSwipe<T extends HTMLElement>(
  ref: React.RefObject<T>,
  options: SwipeOptions
) {
  const { onSwipeRight, onSwipeLeft, threshold = 50 } = options;
  const touchStateRef = useRef<TouchState | null>(null);

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touch = e.touches[0];
    touchStateRef.current = {
      startX: touch.clientX,
      startY: touch.clientY,
      startTime: Date.now()
    };
  }, []);

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (!touchStateRef.current) return;

    const touch = e.changedTouches[0];
    const { startX, startY, startTime } = touchStateRef.current;
    
    const deltaX = touch.clientX - startX;
    const deltaY = touch.clientY - startY;
    const deltaTime = Date.now() - startTime;

    // Reject gestures that are too fast (likely accidental) or too slow
    if (deltaTime < 50 || deltaTime > 500) {
      touchStateRef.current = null;
      return;
    }

    // Ensure horizontal dominance
    if (Math.abs(deltaX) <= Math.abs(deltaY)) {
      touchStateRef.current = null;
      return;
    }

    // Check thresholds
    if (deltaX > threshold && onSwipeRight) {
      onSwipeRight();
    } else if (deltaX < -threshold && onSwipeLeft) {
      onSwipeLeft();
    }

    touchStateRef.current = null;
  }, [onSwipeRight, onSwipeLeft, threshold]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchEnd]);
}

export default useMobileSwipe;