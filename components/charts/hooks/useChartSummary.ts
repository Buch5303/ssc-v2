import { useMemo } from 'react';
import type { ChartDatum } from '../AccessibleChartWrapper';

export function useChartSummary(summaryData: ChartDatum[], seriesKeys: string[]): string {
  return useMemo(() => {
    if (!summaryData || summaryData.length === 0) {
      return 'No data available for this chart.';
    }

    const seriesCount = seriesKeys.length;
    const dataPointCount = summaryData.length;
    
    // Calculate min/max values across all series
    let minValue = Infinity;
    let maxValue = -Infinity;
    let minSeries = '';
    let maxSeries = '';
    let minPeriod = '';
    let maxPeriod = '';

    for (const datum of summaryData) {
      for (const seriesKey of seriesKeys) {
        const value = datum[seriesKey];
        if (typeof value === 'number' && !isNaN(value)) {
          if (value < minValue) {
            minValue = value;
            minSeries = seriesKey;
            minPeriod = String(datum.name || datum.date || datum.period || 'unknown period');
          }
          if (value > maxValue) {
            maxValue = value;
            maxSeries = seriesKey;
            maxPeriod = String(datum.name || datum.date || datum.period || 'unknown period');
          }
        }
      }
    }

    // Format values as currency if they appear to be monetary (>1000 or contain common currency patterns)
    const formatValue = (val: number): string => {
      if (val >= 1000) {
        if (val >= 1000000) {
          return `$${(val / 1000000).toFixed(1)}M`;
        }
        return `$${(val / 1000).toFixed(0)}K`;
      }
      return val.toLocaleString();
    };

    if (minValue === Infinity || maxValue === -Infinity) {
      return `Chart shows ${seriesCount} series over ${dataPointCount} data points. No numeric values found.`;
    }

    const formattedMin = formatValue(minValue);
    const formattedMax = formatValue(maxValue);

    let summary = `Chart shows ${seriesCount} series over ${dataPointCount} data points. `;
    
    if (seriesCount > 1) {
      summary += `${maxSeries} peaked at ${formattedMax} in ${maxPeriod}, ${minSeries} lowest at ${formattedMin} in ${minPeriod}. `;
    } else {
      summary += `Peak value ${formattedMax} in ${maxPeriod}, lowest ${formattedMin} in ${minPeriod}. `;
    }
    
    summary += `Overall range ${formattedMin}–${formattedMax}.`;
    
    return summary;
  }, [summaryData, seriesKeys]);
}