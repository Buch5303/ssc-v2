'use client';

import { useEffect } from 'react';

/**
 * Client-side navigation timing guard for EQS v1.0 compliance
 * Monitors DOM Content Loaded performance against 1.5s budget
 */
export default function NavTimingGuard() {
  useEffect(() => {
    // Feature detection for SSR safety and browser compatibility
    if (typeof window === 'undefined' || !window.performance || !window.PerformanceNavigationTiming) {
      return;
    }

    const checkNavigationTiming = () => {
      const entries = performance.getEntriesByType('navigation');
      
      if (entries.length === 0) {
        // Navigation entry not yet available, defer check
        requestAnimationFrame(checkNavigationTiming);
        return;
      }
      
      const entry = entries[0] as PerformanceNavigationTiming;
      
      // Calculate time from navigation start to DOM Content Loaded
      const elapsed = entry.domContentLoadedEventEnd - entry.startTime;
      
      if (elapsed === 0) {
        // Timing not yet available, defer check
        requestAnimationFrame(checkNavigationTiming);
        return;
      }
      
      // Check against EQS v1.0 Dashboard load < 1.5s requirement
      if (elapsed > 1500) {
        console.warn(
          `[EQS VIOLATION] Dashboard DCL exceeded 1500ms budget: ${elapsed.toFixed(2)}ms`
        );
      }
    };

    // Start timing check after component mount
    checkNavigationTiming();
  }, []);

  // This component renders nothing - it's purely for performance monitoring
  return null;
}