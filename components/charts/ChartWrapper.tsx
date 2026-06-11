import { ReactNode, useState, useEffect } from 'react';
import AccessibleChartWrapper, { ChartDatum } from './AccessibleChartWrapper';

interface ChartWrapperProps {
  children: ReactNode;
  className?: string;
  title?: string;
  data?: ChartDatum[];
  seriesKeys?: string[];
  dataRange?: string;
}

export default function ChartWrapper({ 
  children, 
  className = '', 
  title = 'Chart',
  data = [],
  seriesKeys = [],
  dataRange = 'current period'
}: ChartWrapperProps) {
  // Mobile responsive classes preserved from FS-VIZ-MOB-001
  const baseClasses = 'w-full h-full min-h-[300px] sm:min-h-[400px] lg:min-h-[500px] overflow-hidden';
  const responsiveClasses = 'px-2 sm:px-4 py-2 sm:py-4';
  const combinedClasses = `${baseClasses} ${responsiveClasses} ${className}`.trim();

  return (
    <AccessibleChartWrapper
      chartTitle={title}
      dataRange={dataRange}
      summaryData={data}
      seriesKeys={seriesKeys}
    >
      <div className={combinedClasses}>
        {children}
      </div>
    </AccessibleChartWrapper>
  );
}