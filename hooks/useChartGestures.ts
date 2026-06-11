import { useReducer, useRef, useCallback, useEffect } from 'react';

type GestureState = {
  domainStart: number;
  domainEnd: number;
  zoomLevel: number;
};

type GestureAction =
  | { type: 'PINCH_UPDATE'; scale: number; centerMs: number }
  | { type: 'PAN_UPDATE'; offsetMs: number }
  | { type: 'RESET' };

const MIN_SPAN_MS = 864_000_000; // 1 day

function gestureReducer(
  state: GestureState,
  action: GestureAction,
  dataMinMs: number,
  dataMaxMs: number
): GestureState {
  const dataSpanMs = dataMaxMs - dataMinMs;
  
  switch (action.type) {
    case 'PINCH_UPDATE': {
      const currentSpanMs = state.domainEnd - state.domainStart;
      const newSpanMs = Math.max(MIN_SPAN_MS, Math.min(dataSpanMs, currentSpanMs / action.scale));
      
      // Center the zoom around the pinch point
      const spanDelta = newSpanMs - currentSpanMs;
      let newStart = action.centerMs - newSpanMs / 2;
      let newEnd = action.centerMs + newSpanMs / 2;
      
      // Clamp to data bounds
      if (newStart < dataMinMs) {
        newStart = dataMinMs;
        newEnd = dataMinMs + newSpanMs;
      } else if (newEnd > dataMaxMs) {
        newEnd = dataMaxMs;
        newStart = dataMaxMs - newSpanMs;
      }
      
      return {
        ...state,
        domainStart: newStart,
        domainEnd: newEnd,
        zoomLevel: dataSpanMs / newSpanMs
      };
    }
    
    case 'PAN_UPDATE': {
      const currentSpanMs = state.domainEnd - state.domainStart;
      let newStart = state.domainStart + action.offsetMs;
      let newEnd = state.domainEnd + action.offsetMs;
      
      // Clamp to data bounds
      if (newStart < dataMinMs) {
        newStart = dataMinMs;
        newEnd = dataMinMs + currentSpanMs;
      } else if (newEnd > dataMaxMs) {
        newEnd = dataMaxMs;
        newStart = dataMaxMs - currentSpanMs;
      }
      
      return {
        ...state,
        domainStart: newStart,
        domainEnd: newEnd
      };
    }
    
    case 'RESET': {
      return {
        domainStart: dataMinMs,
        domainEnd: dataMaxMs,
        zoomLevel: 1.0
      };
    }
    
    default:
      return state;
  }
}

export interface ChartGestureHandlers {
  onTouchStart: React.TouchEventHandler<HTMLDivElement>;
  onTouchMove: React.TouchEventHandler<HTMLDivElement>;
  onTouchEnd: React.TouchEventHandler<HTMLDivElement>;
}

export interface ChartGesturesReturn {
  domainStart: number;
  domainEnd: number;
  zoomLevel: number;
  gestureHandlers: ChartGestureHandlers;
  resetZoom: () => void;
}

export function useChartGestures(
  dataMinMs: number,
  dataMaxMs: number,
  containerWidthPx?: number
): ChartGesturesReturn {
  const [state, dispatch] = useReducer(
    (state: GestureState, action: GestureAction) => 
      gestureReducer(state, action, dataMinMs, dataMaxMs),
    {
      domainStart: dataMinMs,
      domainEnd: dataMaxMs,
      zoomLevel: 1.0
    }
  );
  
  const touchStateRef = useRef({
    startTouches: [] as Touch[],
    lastDistance: 0,
    lastCenter: { x: 0, y: 0 },
    lastPanX: 0,
    rafId: null as number | null
  });
  
  const lastTapTimeRef = useRef(0);
  const stateRef = useRef(state);
  
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  
  const pixelToMs = useCallback((pixels: number): number => {
    const currentSpan = stateRef.current.domainEnd - stateRef.current.domainStart;
    const width = containerWidthPx || 400;
    return (pixels / width) * currentSpan;
  }, [containerWidthPx]);
  
  const getDistance = useCallback((touch1: Touch, touch2: Touch): number => {
    const dx = touch2.clientX - touch1.clientX;
    const dy = touch2.clientY - touch1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
  }, []);
  
  const getCenter = useCallback((touch1: Touch, touch2: Touch) => ({
    x: (touch1.clientX + touch2.clientX) / 2,
    y: (touch1.clientY + touch2.clientY) / 2
  }), []);
  
  const onTouchStart = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touches = Array.from(e.touches);
    touchStateRef.current.startTouches = touches;
    
    if (touches.length === 2) {
      touchStateRef.current.lastDistance = getDistance(touches[0], touches[1]);
      touchStateRef.current.lastCenter = getCenter(touches[0], touches[1]);
    } else if (touches.length === 1) {
      touchStateRef.current.lastPanX = touches[0].clientX;
      
      // Double tap detection
      const now = Date.now();
      if (now - lastTapTimeRef.current <= 300) {
        dispatch({ type: 'RESET' });
      }
      lastTapTimeRef.current = now;
    }
  }, [getDistance, getCenter]);
  
  const onTouchMove = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    const touches = Array.from(e.touches);
    
    if (touchStateRef.current.rafId) {
      cancelAnimationFrame(touchStateRef.current.rafId);
    }
    
    touchStateRef.current.rafId = requestAnimationFrame(() => {
      if (touches.length === 2) {
        // Pinch gesture
        const distance = getDistance(touches[0], touches[1]);
        const center = getCenter(touches[0], touches[1]);
        
        if (touchStateRef.current.lastDistance > 0) {
          const scale = distance / touchStateRef.current.lastDistance;
          const centerXRatio = center.x / (containerWidthPx || 400);
          const currentSpan = stateRef.current.domainEnd - stateRef.current.domainStart;
          const centerMs = stateRef.current.domainStart + (centerXRatio * currentSpan);
          
          dispatch({ 
            type: 'PINCH_UPDATE', 
            scale,
            centerMs 
          });
        }
        
        touchStateRef.current.lastDistance = distance;
        touchStateRef.current.lastCenter = center;
        
        e.preventDefault();
      } else if (touches.length === 1 && touchStateRef.current.startTouches.length === 1) {
        // Pan gesture
        const dx = touches[0].clientX - touchStateRef.current.lastPanX;
        const dy = touches[0].clientY - touchStateRef.current.startTouches[0].clientY;
        
        // Only prevent default if horizontal movement is greater than vertical
        if (Math.abs(dx) > Math.abs(dy)) {
          e.preventDefault();
          
          const offsetMs = -pixelToMs(dx);
          dispatch({ type: 'PAN_UPDATE', offsetMs });
        }
        
        touchStateRef.current.lastPanX = touches[0].clientX;
      }
    });
  }, [getDistance, getCenter, containerWidthPx, pixelToMs]);
  
  const onTouchEnd = useCallback((e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStateRef.current.rafId) {
      cancelAnimationFrame(touchStateRef.current.rafId);
      touchStateRef.current.rafId = null;
    }
    
    touchStateRef.current.startTouches = [];
    touchStateRef.current.lastDistance = 0;
  }, []);
  
  const resetZoom = useCallback(() => {
    dispatch({ type: 'RESET' });
  }, []);
  
  return {
    domainStart: state.domainStart,
    domainEnd: state.domainEnd,
    zoomLevel: state.zoomLevel,
    gestureHandlers: {
      onTouchStart,
      onTouchMove,
      onTouchEnd
    },
    resetZoom
  };
}

export type { GestureState };