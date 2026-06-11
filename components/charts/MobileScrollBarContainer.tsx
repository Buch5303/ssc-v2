import { useState, useEffect } from 'react';

interface MobileScrollBarContainerProps {
  children: React.ReactNode;
  barCount: number;
  minBarWidthPx?: number;
}

/**
 * Container that enables horizontal scrolling for dense bar charts on mobile
 * Passes through on desktop or when bar count is manageable
 */
export default function MobileScrollBarContainer({
  children,
  barCount,
  minBarWidthPx = 20
}: MobileScrollBarContainerProps) {
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
      }, 150);
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      clearTimeout(timeoutId);
    };
  }, []);

  const isMobile = windowWidth < 768;
  const needsScrolling = barCount > 10 && isMobile;

  if (!needsScrolling) {
    return <div className="w-full">{children}</div>;
  }

  // Calculate required width for horizontal scrolling
  const requiredWidth = barCount * minBarWidthPx * 1.4; // 1.4 accounts for gaps and padding

  return (
    <div 
      className="w-full overflow-x-scroll"
      style={{
        scrollSnapType: 'x mandatory',
        WebkitOverflowScrolling: 'touch'
      }}
    >
      <div 
        style={{ width: `${requiredWidth}px` }}
        className="min-w-full"
      >
        <div style={{ scrollSnapAlign: 'start' }}>
          {children}
        </div>
      </div>
    </div>
  );
}