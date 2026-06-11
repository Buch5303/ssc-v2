import React from 'react';
import { ResponsiveContainer, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from 'recharts';
import { useChartContext } from './ChartWrapper';

interface BaseChartProps {
  data: any[];
  children: React.ReactNode;
  domainStart?: number;
  domainEnd?: number;
  xAxisProps?: any;
  yAxisProps?: any;
  showGrid?: boolean;
  showTooltip?: boolean;
  showLegend?: boolean;
  height?: number;
}

export function BaseChart({
  data,
  children,
  domainStart: propDomainStart,
  domainEnd: propDomainEnd,
  xAxisProps = {},
  yAxisProps = {},
  showGrid = true,
  showTooltip = true,
  showLegend = true,
  height = 300
}: BaseChartProps) {
  const context = useChartContext();
  
  // Use props first, then context, then auto domain
  const domainStart = propDomainStart ?? context.domainStart;
  const domainEnd = propDomainEnd ?? context.domainEnd;
  
  const xAxisDomainProps = domainStart !== undefined && domainEnd !== undefined ? {
    domain: [domainStart, domainEnd],
    type: 'number' as const,
    scale: 'time' as const,
    allowDataOverflow: false
  } : {};
  
  return (
    <ResponsiveContainer width="100%" height={height}>
      {React.cloneElement(children as React.ReactElement, {
        data,
        children: [
          <CartesianGrid 
            key="grid" 
            strokeDasharray="3 3" 
            className={showGrid ? '' : 'hidden'}
          />,
          <XAxis 
            key="xaxis"
            {...xAxisDomainProps}
            {...xAxisProps}
          />,
          <YAxis 
            key="yaxis"
            {...yAxisProps}
          />,
          showTooltip && <Tooltip key="tooltip" />,
          showLegend && <Legend key="legend" />,
          ...(Array.isArray((children as React.ReactElement).props.children) 
            ? (children as React.ReactElement).props.children 
            : [(children as React.ReactElement).props.children]
          ).filter(Boolean)
        ].filter(Boolean)
      })}
    </ResponsiveContainer>
  );
}