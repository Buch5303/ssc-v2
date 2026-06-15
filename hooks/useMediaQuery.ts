import { useState, useEffect } from 'react';

/**
 * SSR-safe useMediaQuery hook
 * Returns false during SSR (when window is undefined)
 * Subscribes to matchMedia changes on the client
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const media = window.matchMedia(query);
    setMatches(media.matches);

    const listener = (event: MediaQueryListEvent) => {
      setMatches(event.matches);
    };

    media.addEventListener('change', listener);

    return () => {
      media.removeEventListener('change', listener);
    };
  }, [query]);

  return matches;
}

/**
 * Convenience hook for mobile detection
 * Returns true for viewports < 768px
 */
export const useIsMobile = () => useMediaQuery('(max-width: 767px)');
