'use client'

import React from 'react'

interface ErrorBoundaryProps {
  error: Error
  reset: () => void
}

export default function ErrorBoundary({ error, reset }: ErrorBoundaryProps) {
  return (
    <div className="container mx-auto px-4 py-8">
      <div data-testid="rfq-error" className="bg-red-50 border border-red-300 rounded p-4 text-red-800">
        <h2 className="text-xl font-semibold mb-2">Failed to load RFQ data</h2>
        <p data-testid="rfq-error-message" className="mb-4">
          {error.message}
        </p>
        <button
          data-testid="rfq-retry-button"
          onClick={reset}
          className="bg-red-600 text-white px-4 py-2 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
        >
          Retry
        </button>
      </div>
    </div>
  )
}