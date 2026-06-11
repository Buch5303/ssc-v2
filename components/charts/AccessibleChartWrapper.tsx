import { ReactNode, useMemo } from 'react';
import { useChartSummary } from './hooks/useChartSummary';

export interface ChartDatum {
  [key: string]: string | number | undefined;
}

interface AccessibleChartWrapperProps {
  chartTitle: string;
  dataRange: string;
  summaryData: ChartDatum[];
  seriesKeys: string[];
  children: ReactNode;
}

export default function AccessibleChartWrapper({
  chartTitle,
  dataRange,
  summaryData,
  seriesKeys,
  children
}: AccessibleChartWrapperProps) {
  const summaryText = useChartSummary(summaryData, seriesKeys);
  
  const ariaLabel = useMemo(() => {
    return `${chartTitle} — data from ${dataRange}`;
  }, [chartTitle, dataRange]);

  return (
    <figure aria-label={ariaLabel}>
      <figcaption 
        className="sr-only" 
        aria-live="polite" 
        aria-atomic="true"
      >
        {summaryText}
      </figcaption>
      {children}
    </figure>
  );
}