import React from 'react';

interface GestureAffordanceProps {
  zoomLevel: number;
}

export function GestureAffordance({ zoomLevel }: GestureAffordanceProps) {
  const isZoomed = zoomLevel > 1.0;
  
  return (
    <>
      {/* Zoom level indicator */}
      <div className={`absolute top-2 right-2 bg-card border border-border rounded px-2 py-1 text-xs font-mono pointer-events-none transition-opacity duration-200 ${
        isZoomed ? 'opacity-100' : 'opacity-0'
      }`}>
        {zoomLevel.toFixed(1)}×
      </div>
      
      {/* Pan handle indicators */}
      <div className={`absolute left-1 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-200 ${
        isZoomed ? 'opacity-60' : 'opacity-0'
      }`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted">
          <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      
      <div className={`absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none transition-opacity duration-200 ${
        isZoomed ? 'opacity-60' : 'opacity-0'
      }`}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" className="text-muted">
          <path d="M6 3L11 8L6 13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
    </>
  );
}