import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import {
  ResponsiveContainer,
  LineChart,
  AreaChart,
  BarChart,
  PieChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  Line,
  Area,
  Bar,
  Cell
} from 'recharts';
import type { ChartDatum } from './AccessibleChartWrapper';

type ChartType = 'line' | 'area' | 'bar' | 'pie';

interface BaseChartProps {
  type: ChartType;
  data: ChartDatum[];
  seriesKeys: string[];
  title: string;
  xAxisKey?: string;
  colors?: string[];
}

// Focus ring color #0052CC on white background - contrast ratio 5.9:1, exceeds WCAG 2.1 AA 3:1 threshold
const FOCUS_RING_COLOR = '#0052CC';

// Pattern definitions for accessibility
const PATTERN_MAP: Record<string, { strokeDasharray: string; patternId: string }> = {
  series1: { strokeDasharray: 'none', patternId: 'diagonal-stripe-1' },
  series2: { strokeDasharray: '8 4', patternId: 'dot-grid-1' },
  series3: { strokeDasharray: '4 4', patternId: 'cross-hatch-1' },
  series4: { strokeDasharray: '2 6', patternId: 'diagonal-stripe-2' },
};

interface CustomLegendProps {
  payload?: Array<{
    value: string;
    type: string;
    id: string;
    color: string;
  }>;
  onSeriesToggle?: (seriesKey: string) => void;
  hiddenSeries?: Set<string>;
}

function CustomLegend({ payload = [], onSeriesToggle, hiddenSeries = new Set() }: CustomLegendProps) {
  const handleKeyDown = useCallback((event: React.KeyboardEvent, seriesKey: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSeriesToggle?.(seriesKey);
    }
  }, [onSeriesToggle]);

  return (
    <div className="flex flex-wrap justify-center gap-4 mt-4">
      {payload.map((entry, index) => {
        const isHidden = hiddenSeries.has(entry.value);
        return (
          <button
            key={entry.value}
            type="button"
            tabIndex={0}
            className={`
              flex items-center gap-2 px-3 py-1 rounded text-sm
              focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[${FOCUS_RING_COLOR}]
              transition-opacity duration-200
              ${isHidden ? 'opacity-50' : 'opacity-100'}
              hover:bg-gray-50 focus:bg-gray-50
            `}
            onClick={() => onSeriesToggle?.(entry.value)}
            onKeyDown={(e) => handleKeyDown(e, entry.value)}
            aria-pressed={!isHidden}
            aria-label={`Toggle ${entry.value} series visibility`}
          >
            <div 
              className="w-3 h-3 rounded"
              style={{ backgroundColor: entry.color }}
              aria-hidden="true"
            />
            <span>{entry.value}</span>
          </button>
        );
      })}
    </div>
  );
}

export default function BaseChart({ type, data, seriesKeys, title, xAxisKey = 'name', colors = [] }: BaseChartProps) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [activeIndex, setActiveIndex] = useState<number | undefined>(undefined);
  const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

  // Inject SVG accessibility attributes after mount
  useEffect(() => {
    if (!chartRef.current) return;

    const svg = chartRef.current.querySelector('svg');
    if (svg && !svg.getAttribute('role')) {
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', `${title} chart`);
    }
  }, [title, data]);

  // Handle keyboard focus for tooltip
  const handleContainerFocus = useCallback(() => {
    if (data.length > 0) {
      setActiveIndex(0);
    }
  }, [data]);

  const handleContainerKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      setActiveIndex(prev => {
        if (prev === undefined) return 0;
        if (event.key === 'ArrowLeft') {
          return prev > 0 ? prev - 1 : data.length - 1;
        } else {
          return prev < data.length - 1 ? prev + 1 : 0;
        }
      });
    }
  }, [data.length]);

  const handleSeriesToggle = useCallback((seriesKey: string) => {
    setHiddenSeries(prev => {
      const next = new Set(prev);
      if (next.has(seriesKey)) {
        next.delete(seriesKey);
      } else {
        next.add(seriesKey);
      }
      return next;
    });
  }, []);

  // Filter data to hide series
  const visibleData = useMemo(() => {
    if (hiddenSeries.size === 0) return data;
    return data.map(item => {
      const newItem = { ...item };
      hiddenSeries.forEach(seriesKey => {
        if (seriesKey in newItem) {
          delete newItem[seriesKey];
        }
      });
      return newItem;
    });
  }, [data, hiddenSeries]);

  // Custom dot renderer with patterns for accessibility
  const renderCustomDot = useCallback((props: any, seriesIndex: number) => {
    const { cx, cy, fill } = props;
    const pattern = Object.values(PATTERN_MAP)[seriesIndex % Object.keys(PATTERN_MAP).length];
    
    return (
      <circle
        cx={cx}
        cy={cy}
        r={3}
        fill={fill}
        stroke={fill}
        strokeWidth={2}
        strokeDasharray={pattern.strokeDasharray}
      />
    );
  }, []);

  const renderPatternDefs = () => (
    <defs>
      <pattern id="diagonal-stripe-1" patternUnits="userSpaceOnUse" width="4" height="4">
        <path d="M 0,4 l 4,-4 M -1,1 l 2,-2 M 3,5 l 2,-2" stroke="currentColor" strokeWidth="1" />
      </pattern>
      <pattern id="dot-grid-1" patternUnits="userSpaceOnUse" width="6" height="6">
        <circle cx="3" cy="3" r="1" fill="currentColor" />
      </pattern>
      <pattern id="cross-hatch-1" patternUnits="userSpaceOnUse" width="8" height="8">
        <path d="M 0,0 l 8,8 M 0,8 l 8,-8" stroke="currentColor" strokeWidth="1" />
      </pattern>
      <pattern id="diagonal-stripe-2" patternUnits="userSpaceOnUse" width="6" height="6">
        <path d="M 0,0 l 6,6 M -1.5,1.5 l 3,-3 M 4.5,7.5 l 3,-3" stroke="currentColor" strokeWidth="1" />
      </pattern>
    </defs>
  );

  const chartProps = {
    data: visibleData,
    activeIndex,
    onMouseLeave: () => setActiveIndex(undefined)
  };

  const renderChart = () => {
    switch (type) {
      case 'line':
        return (
          <LineChart {...chartProps}>
            {renderPatternDefs()}
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            <Tooltip />
            {seriesKeys.map((key, index) => {
              if (hiddenSeries.has(key)) return null;
              const pattern = Object.values(PATTERN_MAP)[index % Object.keys(PATTERN_MAP).length];
              const color = colors[index] || `hsl(${(index * 137.508) % 360}, 70%, 50%)`;
              
              return (
                <Line
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={pattern.strokeDasharray}
                  dot={(props) => renderCustomDot(props, index)}
                  activeDot={{ r: 6, strokeWidth: 2 }}
                />
              );
            })}
          </LineChart>
        );

      case 'area':
        return (
          <AreaChart {...chartProps}>
            {renderPatternDefs()}
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            <Tooltip />
            {seriesKeys.map((key, index) => {
              if (hiddenSeries.has(key)) return null;
              const pattern = Object.values(PATTERN_MAP)[index % Object.keys(PATTERN_MAP).length];
              const color = colors[index] || `hsl(${(index * 137.508) % 360}, 70%, 50%)`;
              
              return (
                <Area
                  key={key}
                  type="monotone"
                  dataKey={key}
                  stroke={color}
                  strokeWidth={2}
                  strokeDasharray={pattern.strokeDasharray}
                  fill={color}
                  fillOpacity={0.3}
                  dot={(props) => renderCustomDot(props, index)}
                />
              );
            })}
          </AreaChart>
        );

      case 'bar':
        return (
          <BarChart {...chartProps}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey={xAxisKey} />
            <YAxis />
            <Tooltip />
            {seriesKeys.map((key, index) => {
              if (hiddenSeries.has(key)) return null;
              const color = colors[index] || `hsl(${(index * 137.508) % 360}, 70%, 50%)`;
              
              return (
                <Bar
                  key={key}
                  dataKey={key}
                  fill={color}
                />
              );
            })}
          </BarChart>
        );

      case 'pie':
        return (
          <PieChart>
            {/* Pie chart implementation would go here */}
          </PieChart>
        );

      default:
        return null;
    }
  };

  return (
    <div className="w-full h-full">
      <div
        ref={chartRef}
        className="w-full h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0052CC]"
        tabIndex={0}
        onFocus={handleContainerFocus}
        onKeyDown={handleContainerKeyDown}
        role="application"
        aria-label={`Interactive ${title} chart. Use arrow keys to navigate data points.`}
      >
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>
      <CustomLegend
        payload={seriesKeys.map((key, index) => ({
          value: key,
          type: 'line',
          id: key,
          color: colors[index] || `hsl(${(index * 137.508) % 360}, 70%, 50%)`
        }))}
        onSeriesToggle={handleSeriesToggle}
        hiddenSeries={hiddenSeries}
      />
    </div>
  );
}