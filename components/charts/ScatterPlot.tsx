import React from 'react';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ResponsiveChartWrapper, clampTooltipPosition } from './ResponsiveChartWrapper';

interface ScatterPlotData {
  x: number;
  y: number;
  name?: string;
  [key: string]: any;
}

interface CustomScatterPlotProps {
  data: ScatterPlotData[];
  containerWidth?: number;
  className?: string;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

function CustomScatterPlot({ 
  data, 
  containerWidth = 0, 
  className = '',
  xAxisLabel = '',
  yAxisLabel = ''
}: CustomScatterPlotProps) {
  const isMobile = containerWidth < 480;
  const tickCount = isMobile ? 4 : 8;
  
  const margin = {
    top: 8,
    right: 8,
    bottom: 8,
    left: isMobile ? 4 : 24
  };

  return (
    <ScatterChart
      data={data}
      margin={margin}
      className={className}
    >
      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
      <XAxis 
        type="number"
        dataKey="x"
        tickCount={tickCount}
        tick={{ fontSize: isMobile ? 10 : 12 }}
        className="text-muted-foreground"
        label={xAxisLabel ? { 
          value: xAxisLabel, 
          position: 'insideBottom', 
          offset: -5,
          style: { fontSize: isMobile ? '10px' : '12px' }
        } : undefined}
      />
      <YAxis 
        type="number"
        dataKey="y"
        tickCount={tickCount}
        tick={{ fontSize: isMobile ? 10 : 12 }}
        className="text-muted-foreground"
        label={yAxisLabel ? {
          value: yAxisLabel,
          angle: -90,
          position: 'insideLeft',
          style: { fontSize: isMobile ? '10px' : '12px' }
        } : undefined}
      />
      <Tooltip
        position={(props) => clampTooltipPosition(props.coordinate, props.viewBox, containerWidth)}
        contentStyle={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '6px',
          fontSize: isMobile ? '12px' : '14px'
        }}
        formatter={(value, name) => [value, name || 'Value']}
      />
      <Scatter 
        data={data}
        fill="hsl(var(--accent))"
        r={isMobile ? 3 : 4}
      />
    </ScatterChart>
  );
}

export default function ResponsiveScatterPlot(props: Omit<CustomScatterPlotProps, 'containerWidth'>) {
  return (
    <ResponsiveChartWrapper>
      <CustomScatterPlot {...props} />
    </ResponsiveChartWrapper>
  );
}