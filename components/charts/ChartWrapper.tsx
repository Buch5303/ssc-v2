import { useAdaptiveTicks } from '@/lib/charts/useAdaptiveTicks';
import { downsampleData } from '@/lib/charts/downsampleData';
import MobileScrollBarContainer from './MobileScrollBarContainer';

export interface ChartDensityContext {
  ticks: unknown[];
  isMobile: boolean;
  downsample: <T extends Record<string, unknown>>(data: T[], maxPoints: number, valueKey: string) => T[];
}

interface ChartWrapperProps {
  children: ((ctx: ChartDensityContext) => React.ReactNode) | React.ReactNode;
  chartType?: 'bar' | 'line' | 'area';
  data?: unknown[];
  dataKey?: string;
}

/**
 * Shared wrapper for all dashboard charts providing mobile density management
 * Supports both render-prop pattern and legacy direct children
 */
export default function ChartWrapper({
  children,
  chartType,
  data = [],
  dataKey = 'x'
}: ChartWrapperProps) {
  const { ticks, isMobile } = useAdaptiveTicks(data, dataKey);

  // Create density context with pre-bound downsample function
  const context: ChartDensityContext = {
    ticks,
    isMobile,
    downsample: <T extends Record<string, unknown>>(data: T[], maxPoints: number, valueKey: string) => {
      // Only downsample on mobile to maxPoints=50, otherwise return unchanged
      if (isMobile && data.length > maxPoints) {
        return downsampleData(data, maxPoints, valueKey);
      }
      return data;
    }
  };

  // Handle render-prop pattern vs legacy children
  let content: React.ReactNode;
  
  if (typeof children === 'function') {
    content = children(context);
  } else {
    // Legacy mode - log deprecation warning and pass through
    console.warn('ChartWrapper: passing non-function children is deprecated. Use render-prop pattern: children={(ctx) => <YourChart />}');
    content = <div>{children}</div>;
  }

  // Wrap bar charts in mobile scroll container
  if (chartType === 'bar') {
    return (
      <MobileScrollBarContainer barCount={data.length}>
        {content}
      </MobileScrollBarContainer>
    );
  }

  return <div className="w-full">{content}</div>;
}

/**
 * Utility function for truncating tick labels with ellipsis
 * Callers must set title attribute on tick elements for accessibility
 * @param value - Label value to truncate
 * @param maxChars - Maximum characters before truncation (default 10)
 * @returns Truncated string with ellipsis if needed
 */
export function truncatedTickFormatter(value: string, maxChars = 10): string {
  if (typeof value !== 'string') return String(value);
  return value.length > maxChars ? value.slice(0, maxChars) + '\u2026' : value;
}