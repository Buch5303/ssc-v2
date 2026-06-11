import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ResponsiveContainer } from 'recharts';

interface ViewBox {
  height?: number;
  width?: number;
}

interface Coordinate {
  x?: number;
  y?: number;
}

interface ResponsiveChartWrapperProps {
  children: React.ReactNode;
  mobileAspectRatio?: number;
  className?: string;
}

// Utility to calculate tick interval for responsive charts
export function calcTickInterval(
  dataLength: number,
  containerWidth: number,
  minTickPx: number
): number {
  if (dataLength === 0 || containerWidth === 0 || minTickPx === 0) {
    return 1;
  }
  const result = Math.ceil(dataLength / Math.floor(containerWidth / minTickPx));
  return Math.max(1, result);
}

// Utility to clamp tooltip position within viewport bounds
export function clampTooltipPosition(
  coordinate?: Coordinate,
  viewBox?: ViewBox,
  containerWidth?: number
): { x: number; y: number } | undefined {
  if (!coordinate || !viewBox || !containerWidth) {
    return undefined;
  }

  const tooltipWidth = 160;
  const tooltipHeight = 80;
  
  const x = Math.min(
    coordinate.x || 0,
    containerWidth - tooltipWidth
  );
  
  const y = Math.min(
    coordinate.y || 0,
    (viewBox.height || 400) - tooltipHeight
  );

  return { x, y };
}

// Hook to track container width with debounced ResizeObserver
function useContainerWidth() {
  const [width, setWidth] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);

  const updateDimensions = useCallback(() => {
    if (containerRef.current) {
      setWidth(containerRef.current.offsetWidth);
    }
  }, []);

  const debouncedUpdate = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = setTimeout(updateDimensions, 100);
  }, [updateDimensions]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    // Initial measurement
    updateDimensions();

    // Set up ResizeObserver if available, otherwise fall back to window resize
    if (typeof ResizeObserver !== 'undefined') {
      observerRef.current = new ResizeObserver(debouncedUpdate);
      observerRef.current.observe(element);
    } else {
      // Fallback for older browsers
      window.addEventListener('resize', debouncedUpdate);
    }

    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      } else {
        window.removeEventListener('resize', debouncedUpdate);
      }
    };
  }, [debouncedUpdate, updateDimensions]);

  return { width, containerRef };
}

export function ResponsiveChartWrapper({
  children,
  mobileAspectRatio = 1.4,
  className = ''
}: ResponsiveChartWrapperProps) {
  const { width, containerRef } = useContainerWidth();
  
  const height = width < 480 ? width / mobileAspectRatio : undefined;

  return (
    <div 
      ref={containerRef} 
      className={`overflow-hidden w-full ${className}`}
      style={{ minWidth: 0 }}
    >
      <ResponsiveContainer 
        width="100%" 
        height={height}
        minWidth={0}
      >
        {React.cloneElement(children as React.ReactElement, { containerWidth: width })}
      </ResponsiveContainer>
    </div>
  );
}