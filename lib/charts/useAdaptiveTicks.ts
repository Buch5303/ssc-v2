import { useState, useEffect } from 'react';

/**
 * Hook for adaptive tick calculation based on viewport size
 * Returns reduced ticks for mobile viewports to prevent label overlap
 */
export function useAdaptiveTicks(
  data: unknown[],
  dataKey: string
): { ticks: unknown[]; isMobile: boolean } {
  const [windowWidth, setWindowWidth] = useState<number>(
    typeof window !== 'undefined' ? window.innerWidth : 1200
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let timeoutId: ReturnType<typeof setTimeout>;

    const handleResize = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setWindowWidth(window.innerWidth);
      }, 150); // Debounce resize events
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  const isMobile = windowWidth < 768;

  const ticks = isMobile ? calculateMobileTicks(data, dataKey) : [];

  return { ticks, isMobile };
}

/**
 * Calculate evenly-spaced ticks for mobile viewports
 * @param data - Chart data array
 * @param dataKey - Key to extract tick values from
 * @returns Array of tick values
 */
function calculateMobileTicks(data: unknown[], dataKey: string): unknown[] {
  if (data.length <= 5) {
    // If data is small enough, return all values
    return data.map(item => {
      if (item && typeof item === 'object' && dataKey in item) {
        return (item as Record<string, unknown>)[dataKey];
      }
      return item;
    });
  }

  // Pick 5 evenly-spaced indices: first, last, and 3 interior
  const indices = [
    0,
    Math.floor(data.length * 0.25),
    Math.floor(data.length * 0.5),
    Math.floor(data.length * 0.75),
    data.length - 1
  ];

  // Remove duplicates and sort
  const uniqueIndices = [...new Set(indices)].sort((a, b) => a - b);

  return uniqueIndices.map(index => {
    const item = data[index];
    if (item && typeof item === 'object' && dataKey in item) {
      return (item as Record<string, unknown>)[dataKey];
    }
    return item;
  });
}