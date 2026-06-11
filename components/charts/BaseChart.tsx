import React from 'react';
import { TouchableChartWrapper, useChartGestureContext } from './TouchableChartWrapper';

interface ChartDataPoint {
  label: string;
  value: number;
  unit?: string;
  timestamp: string;
  seriesName: string;
  sourceId: string;
}

interface BaseChartProps {
  children: React.ReactNode;
  data?: any[];
  seriesCount?: number;
  chartType?: 'timeseries' | 'categorical';
  originalDomain?: [number, number];
  onDataPointLongPress?: (dataPoint: ChartDataPoint) => void;
}

// Inner component that consumes the gesture context
function ChartContent({ children }: { children: React.ReactNode }) {
  const { zoomDomain, activeSeriesIndex } = useChartGestureContext();

  // Clone children and inject gesture props
  return React.Children.map(children, (child) => {
    if (React.isValidElement(child)) {
      // Pass gesture state as props that can be consumed by chart components
      return React.cloneElement(child, {
        ...child.props,
        gestureZoomDomain: zoomDomain,
        gestureActiveSeriesIndex: activeSeriesIndex
      });
    }
    return child;
  });
}

export function BaseChart({
  children,
  data = [],
  seriesCount = 1,
  chartType = 'categorical',
  originalDomain = [0, 100],
  onDataPointLongPress
}: BaseChartProps) {
  return (
    <TouchableChartWrapper
      seriesCount={seriesCount}
      chartType={chartType}
      originalDomain={originalDomain}
      onDataPointLongPress={onDataPointLongPress}
    >
      <ChartContent>{children}</ChartContent>
    </TouchableChartWrapper>
  );
}