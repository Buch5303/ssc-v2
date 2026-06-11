import React from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { ResponsiveChartWrapper, calcTickInterval } from './ResponsiveChartWrapper';

interface LineChartData {
  name: string;
  value: number;
  [key: string]: any;
}

interface CustomLineChartProps {
  data: LineChartData[];
  containerWidth?: number;
  className?: string;
  dataKey?: string;
  nameKey?: string;
}

function CustomLineChart({ 
  data, 
  containerWidth = 0, 
  className = '',
  dataKey = 'value',
  nameKey = 'name'
}: CustomLineChartProps) {
  const isMobile = containerWidth < 480;
  const tickInterval = calcTickInterval(data.length, containerWidth, 60);
  
  const margin = {
    top: 8,
    right: 8,
    bottom: 8,
    left: isMobile ? 4 : 24
  };

  return (
    <LineChart
      data={data}
      margin={margin}
      className={className}
    >
      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
      <XAxis 
        dataKey={nameKey}
        interval={tickInterval}
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
      <Line 
        type="monotone" 
        dataKey={dataKey} 
        stroke="hsl(var(--accent))" 
        strokeWidth={2}
        dot={{ fill: 'hsl(var(--accent))', strokeWidth: 2, r: isMobile ? 3 : 4 }}
        activeDot={{ r: isMobile ? 4 : 6, stroke: 'hsl(var(--accent))', strokeWidth: 2 }}
      />
    </LineChart>
  );
}

export default function ResponsiveLineChart(props: Omit<CustomLineChartProps, 'containerWidth'>) {
  return (
    <ResponsiveChartWrapper>
      <CustomLineChart {...props} />
    </ResponsiveChartWrapper>
  );
}