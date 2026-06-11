import React from 'react';
import { ResponsiveChartWrapper } from './ResponsiveChartWrapper';

interface HeatmapData {
  x: number;
  y: number;
  value: number;
  label?: string;
}

interface HeatmapChartProps {
  data: HeatmapData[];
  xLabels: string[];
  yLabels: string[];
  containerWidth?: number;
  className?: string;
  colorScale?: (value: number) => string;
}

function CustomHeatmapChart({ 
  data, 
  xLabels, 
  yLabels, 
  containerWidth = 0, 
  className = '',
  colorScale = (value: number) => `hsl(var(--accent), ${Math.min(100, value)}%)`
}: HeatmapChartProps) {
  const isMobile = containerWidth < 480;
  const numCols = xLabels.length;
  const numRows = yLabels.length;
  
  const cellWidth = containerWidth / numCols;
  const cellHeight = cellWidth * 0.75;
  const svgHeight = Math.round(containerWidth * 0.5);
  
  const fontSize = isMobile ? 8 : 10;
  const labelOffset = isMobile ? 12 : 16;

  // Filter labels on mobile to prevent overlap
  const visibleXLabels = isMobile 
    ? xLabels.filter((_, index) => index % 2 === 0)
    : xLabels;
  const visibleYLabels = isMobile 
    ? yLabels.filter((_, index) => index % 2 === 0)
    : yLabels;

  return (
    <div className={`overflow-hidden ${className}`}>
      <svg
        width="100%"
        height="auto"
        viewBox={`0 0 ${containerWidth} ${svgHeight}`}
        className="text-muted-foreground"
      >
        {/* Render heatmap cells */}
        {data.map((point, index) => {
          const x = point.x * cellWidth;
          const y = point.y * cellHeight;
          
          return (
            <rect
              key={index}
              x={x}
              y={y}
              width={cellWidth - 1}
              height={cellHeight - 1}
              fill={colorScale(point.value)}
              stroke="hsl(var(--border))"
              strokeWidth={0.5}
            >
              <title>{point.label || `${point.value}`}</title>
            </rect>
          );
        })}
        
        {/* X-axis labels */}
        {visibleXLabels.map((label, index) => {
          const actualIndex = isMobile ? index * 2 : index;
          const x = (actualIndex + 0.5) * cellWidth;
          const y = numRows * cellHeight + labelOffset;
          
          return (
            <text
              key={`x-${index}`}
              x={x}
              y={y}
              textAnchor="middle"
              fontSize={fontSize}
              fill="currentColor"
            >
              {label}
            </text>
          );
        })}
        
        {/* Y-axis labels */}
        {visibleYLabels.map((label, index) => {
          const actualIndex = isMobile ? index * 2 : index;
          const x = -8;
          const y = (actualIndex + 0.5) * cellHeight + fontSize / 2;
          
          return (
            <text
              key={`y-${index}`}
              x={x}
              y={y}
              textAnchor="end"
              fontSize={fontSize}
              fill="currentColor"
            >
              {label}
            </text>
          );
        })}
      </svg>
    </div>
  );
}

export default function ResponsiveHeatmapChart(props: Omit<HeatmapChartProps, 'containerWidth'>) {
  return (
    <ResponsiveChartWrapper>
      <CustomHeatmapChart {...props} />
    </ResponsiveChartWrapper>
  );
}