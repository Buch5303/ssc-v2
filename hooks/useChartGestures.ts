import { useRef, useEffect, useState, useCallback } from 'react';

interface GestureState {
  zoomDomain: [number, number] | null;
  activeSeriesIndex: number;
  panOffset: number;
  longPressData: ChartDataPoint | null;
}

interface ChartDataPoint {
  label: string;
  value: number;
  unit?: string;
  timestamp: string;
  seriesName: string;
  sourceId: string;
}

interface UseChartGesturesOptions {
  seriesCount: number;
  chartType: 'timeseries' | 'categorical';
  originalDomain: [number, number];
  onDataPointHit?: (point: ChartDataPoint) => void;
}

interface PointerState {
  id: number;
  x: number;
  y: number;
}

export function useChartGestures({
  seriesCount,
  chartType,
  originalDomain,
  onDataPointHit
}: UseChartGesturesOptions) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, PointerState>>(new Map());
  const initialDistanceRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);
  const startPositionRef = useRef<{ x: number; y: number } | null>(null);
  
  const [gestureState, setGestureState] = useState<GestureState>({
    zoomDomain: null,
    activeSeriesIndex: 0,
    panOffset: 0,
    longPressData: null
  });

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const calculateDistance = useCallback((p1: PointerState, p2: PointerState): number => {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }, []);

  const handlePointerDown = useCallback((event: PointerEvent) => {
    const pointer: PointerState = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    };
    
    pointersRef.current.set(event.pointerId, pointer);
    
    // Start long press timer for single pointer
    if (pointersRef.current.size === 1) {
      startPositionRef.current = { x: event.clientX, y: event.clientY };
      longPressTimerRef.current = setTimeout(() => {
        if (startPositionRef.current && onDataPointHit) {
          // In a real implementation, this would hit-test against chart data
          // For now, we need the parent to provide the data point
          const mockDataPoint: ChartDataPoint = {
            label: 'Sample Data',
            value: 100,
            unit: 'USD',
            timestamp: new Date().toISOString(),
            seriesName: 'Series 1',
            sourceId: 'chart-gesture-' + Date.now()
          };
          onDataPointHit(mockDataPoint);
        }
      }, 500);
    } else {
      clearLongPressTimer();
    }

    // Initialize pinch distance for two pointers
    if (pointersRef.current.size === 2) {
      const pointers = Array.from(pointersRef.current.values());
      initialDistanceRef.current = calculateDistance(pointers[0], pointers[1]);
    }
  }, [calculateDistance, clearLongPressTimer, onDataPointHit]);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const existingPointer = pointersRef.current.get(event.pointerId);
    if (!existingPointer) return;

    // Check for long press cancellation
    if (startPositionRef.current && pointersRef.current.size === 1) {
      const movementDistance = Math.sqrt(
        Math.pow(event.clientX - startPositionRef.current.x, 2) +
        Math.pow(event.clientY - startPositionRef.current.y, 2)
      );
      if (movementDistance > 8) {
        clearLongPressTimer();
      }
    }

    // Update pointer position
    pointersRef.current.set(event.pointerId, {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY
    });

    // Handle pinch-to-zoom for two pointers
    if (pointersRef.current.size === 2 && initialDistanceRef.current) {
      const pointers = Array.from(pointersRef.current.values());
      const currentDistance = calculateDistance(pointers[0], pointers[1]);
      const scale = currentDistance / initialDistanceRef.current;
      
      // Clamp scale to [0.5x, 8x]
      const clampedScale = Math.max(0.5, Math.min(8, scale));
      
      const [min, max] = originalDomain;
      const range = max - min;
      const center = (min + max) / 2;
      const newRange = range / clampedScale;
      
      setGestureState(prev => ({
        ...prev,
        zoomDomain: [center - newRange / 2, center + newRange / 2]
      }));
    }
  }, [calculateDistance, clearLongPressTimer, originalDomain]);

  const handlePointerUp = useCallback((event: PointerEvent) => {
    const pointer = pointersRef.current.get(event.pointerId);
    if (!pointer) return;

    // Handle swipe gesture for single pointer
    if (pointersRef.current.size === 1 && startPositionRef.current) {
      const deltaX = event.clientX - startPositionRef.current.x;
      const deltaY = event.clientY - startPositionRef.current.y;
      const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
      
      // Check for horizontal swipe (threshold: 40px)
      if (Math.abs(deltaX) > 40 && Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX < 0) {
          // Swipe left - increment series
          setGestureState(prev => ({
            ...prev,
            activeSeriesIndex: (prev.activeSeriesIndex + 1) % seriesCount
          }));
        } else {
          // Swipe right - decrement series
          setGestureState(prev => ({
            ...prev,
            activeSeriesIndex: prev.activeSeriesIndex === 0 ? seriesCount - 1 : prev.activeSeriesIndex - 1
          }));
        }
      }
    }

    pointersRef.current.delete(event.pointerId);
    clearLongPressTimer();
    startPositionRef.current = null;

    // Reset initial distance when no pointers left
    if (pointersRef.current.size < 2) {
      initialDistanceRef.current = null;
    }
  }, [seriesCount, clearLongPressTimer]);

  const setLongPressData = useCallback((data: ChartDataPoint | null) => {
    setGestureState(prev => ({ ...prev, longPressData: data }));
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('pointerdown', handlePointerDown, { passive: true });
    container.addEventListener('pointermove', handlePointerMove, { passive: true });
    container.addEventListener('pointerup', handlePointerUp, { passive: true });
    container.addEventListener('pointercancel', handlePointerUp, { passive: true });

    return () => {
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', handlePointerUp);
      container.removeEventListener('pointercancel', handlePointerUp);
      clearLongPressTimer();
    };
  }, [handlePointerDown, handlePointerMove, handlePointerUp, clearLongPressTimer]);

  return {
    containerRef,
    gestureState,
    setLongPressData
  };
}