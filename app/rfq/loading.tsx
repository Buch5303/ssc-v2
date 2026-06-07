export default function Loading() {
  return (
    <div aria-label="Loading RFQ data" data-testid="rfq-loading" className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">RFQ Dashboard</h1>
      <div className="animate-pulse space-y-3 p-4">
        {Array.from({ length: 5 }).map((_, index) => (
          <div
            key={index}
            className="h-4 bg-gray-200 rounded w-full mb-3"
            data-testid="rfq-skeleton-row"
          />
        ))}
      </div>
    </div>
  )
}