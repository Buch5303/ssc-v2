import React, { createContext, useContext } from 'react';
import { useChartGestures } from '../../hooks/useChartGestures';
import { PersistentTooltipModal } from './PersistentTooltipModal';

interface ChartDataPoint {
  label: string;
  value: number;
  unit?: string;
  timestamp: string;
  seriesName: string;
  sourceId: string;
}

interface ChartGestureContext {
  zoomDomain: [number, number] | null;
  activeSeriesIndex: number;
}

const ChartGestureContext = createContext<ChartGestureContext | null>(null);

export const useChartGestureContext = () => {
  const context = useContext(ChartGestureContext);
  if (!context) {
    throw new Error('useChartGestureContext must be used within TouchableChartWrapper');
  }
  return context;
};

interface TouchableChartWrapperProps {
  children: React.ReactNode;
  seriesCount: number;
  chartType: 'timeseries' | 'categorical';
  originalDomain: [number, number];
  onDataPointLongPress?: (dataPoint: ChartDataPoint) => void;
}

export function TouchableChartWrapper({
  children,
  seriesCount,
  chartType,
  originalDomain,
  onDataPointLongPress
}: TouchableChartWrapperProps) {
  const { containerRef, gestureState, setLongPressData } = useChartGestures({
    seriesCount,
    chartType,
    originalDomain,
    onDataPointHit: (dataPoint) => {
      setLongPressData(dataPoint);
      onDataPointLongPress?.(dataPoint);
    }
  });

  const contextValue: ChartGestureContext = {
    zoomDomain: gestureState.zoomDomain,
    activeSeriesIndex: gestureState.activeSeriesIndex
  };

  return (
    <ChartGestureContext.Provider value={contextValue}>
      <div 
        ref={containerRef}
        className="relative w-full h-full"
        style={{ touchAction: 'pan-y pinch-zoom' }}
      >
        {children}
        
        {gestureState.longPressData && (
          <PersistentTooltipModal
            dataPoint={gestureState.longPressData}
            onClose={() => setLongPressData(null)}
          />
        )}
      </div>
    </ChartGestureContext.Provider>
  );
}