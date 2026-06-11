import React, { createContext, useContext, useRef, useEffect, useState } from 'react';
import { useChartGestures, ChartGesturesReturn } from '@/hooks/useChartGestures';
import { GestureAffordance } from './GestureAffordance';

interface ChartContextValue {
  domainStart?: number;
  domainEnd?: number;
  zoomLevel?: number;
  resetZoom?: () => void;
}

const ChartContext = createContext<ChartContextValue>({});

export const useChartContext = () => useContext(ChartContext);

interface ChartWrapperProps {
  children: React.ReactNode;
  enableGestures?: boolean;
  dataMinMs?: number;
  dataMaxMs?: number;
  className?: string;
}

export function ChartWrapper({ 
  children, 
  enableGestures = typeof window !== 'undefined' && 'ontouchstart' in window,
  dataMinMs,
  dataMaxMs,
  className = '' 
}: ChartWrapperProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState<number>(400);
  
  const gestures = useChartGestures(
    dataMinMs || 0,
    dataMaxMs || Date.now(),
    containerWidth
  );
  
  useEffect(() => {
    const updateWidth = () => {
      if (containerRef.current) {
        setContainerWidth(containerRef.current.offsetWidth);
      }
    };
    
    updateWidth();
    window.addEventListener('resize', updateWidth);
    
    return () => {
      window.removeEventListener('resize', updateWidth);
    };
  }, []);
  
  const chartContextValue: ChartContextValue = enableGestures && dataMinMs !== undefined && dataMaxMs !== undefined ? {
    domainStart: gestures.domainStart,
    domainEnd: gestures.domainEnd,
    zoomLevel: gestures.zoomLevel,
    resetZoom: gestures.resetZoom
  } : {};
  
  const wrapperProps = enableGestures && dataMinMs !== undefined && dataMaxMs !== undefined ? {
    ...gestures.gestureHandlers,
    className: `${className} touch-pan-y relative`,
    ref: containerRef
  } : {
    className: `${className} relative`,
    ref: containerRef
  };
  
  return (
    <div {...wrapperProps}>
      <ChartContext.Provider value={chartContextValue}>
        {children}
        {enableGestures && dataMinMs !== undefined && dataMaxMs !== undefined && (
          <GestureAffordance zoomLevel={gestures.zoomLevel} />
        )}
      </ChartContext.Provider>
    </div>
  );
}