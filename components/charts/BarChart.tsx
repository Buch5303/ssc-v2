import React from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ResponsiveChartWrapper, calcTickInterval } from './ResponsiveChartWrapper';

interface BarChartData {
  name: string;
  value: number;
  [key: string]: any;
}

interface CustomBarChartProps {
  data: BarChartData[];
  containerWidth?: number;
  className?: string;
  dataKey?: string;
  nameKey?: string;
}

function CustomBarChart({ 
  data, 
  containerWidth = 0, 
  className = '',
  dataKey = 'value',
  nameKey = 'name'
}: CustomBarChartProps) {
  const isMobile = containerWidth < 480;
  const tickInterval = calcTickInterval(data.length, containerWidth, 60);
  const barSize = Math.max(4, Math.floor(containerWidth / data.length / 1.8));
  
  const margin = {
    top: 8,
    right: 8,
    bottom: 8,
    left: isMobile ? 4 : 24
  };

  const tickFormatter = (val: any) => {
    if (isMobile) {
      return String(val).slice(0, 4);
    }
    return val;
  };

  return (
    <BarChart
      data={data}
      margin={margin}
      className={className}
    >
      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
      <XAxis 
        dataKey={nameKey}
        interval={tickInterval}
        tickFormatter={tickFormatter}
        tick={{ fontSize: isMobile ? 10 : 12 }}
        className="text-muted-foreground"
      />
      <YAxis 
        tick={{ fontSize: isMobile ? 10 : 12 }}
        className="text-muted-foreground"
      />
      <Tooltip
        allowEscapeViewBox={{ x: false, y: false }}
        contentStyle={{
          backgroundColor: 'hsl(var(--card))',
          border: '1px solid hsl(var(--border))',
          borderRadius: '6px',
          fontSize: isMobile ? '12px' : '14px'
        }}
      />
      <Bar 
        dataKey={dataKey} 
        fill="hsl(var(--accent))"
        maxBarSize={barSize}
      />
    </BarChart>
  );
}

export default function ResponsiveBarChart(props: Omit<CustomBarChartProps, 'containerWidth'>) {
  return (
    <ResponsiveChartWrapper>
      <CustomBarChart {...props} />
    </ResponsiveChartWrapper>
  );
}