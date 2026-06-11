import React from 'react';

interface ChartDataPoint {
  label: string;
  value: number;
  unit?: string;
  timestamp: string;
  seriesName: string;
  sourceId: string;
}

interface PersistentTooltipModalProps {
  dataPoint: ChartDataPoint;
  onClose: () => void;
}

export function PersistentTooltipModal({ dataPoint, onClose }: PersistentTooltipModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/20 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 shadow-lg p-6 mx-4 max-w-sm w-full">
        {/* Close Button - exactly 44x44px */}
        <button
          onClick={onClose}
          className="absolute top-2 right-2 w-11 h-11 flex items-center justify-center text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          aria-label="Close tooltip"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Content */}
        <div className="space-y-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
              {dataPoint.seriesName}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {dataPoint.label}
            </p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Value:</span>
              <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                {dataPoint.value.toLocaleString()}
                {dataPoint.unit && ` ${dataPoint.unit}`}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Time:</span>
              <span className="text-sm font-mono text-gray-900 dark:text-gray-100">
                {new Date(dataPoint.timestamp).toLocaleString()}
              </span>
            </div>

            <div className="flex justify-between">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">Source ID:</span>
              <span className="text-xs font-mono text-gray-600 dark:text-gray-400 break-all">
                {dataPoint.sourceId}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}