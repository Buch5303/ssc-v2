// Extracted from app/rfq/page.tsx: a page file may only export a default
// component plus Next config fields, so the table lives here as its own
// component — also makes it independently testable.

export interface RFQ {
  id: string
  title: string
  status: string
  // Mirror the /api/rfq response: Drizzle $inferSelect yields camelCase.
  createdAt: string
  // rfqs has no monetary column yet — optional until the schema carries one.
  value?: number | null
}

export function RFQTable({ rfqs }: { rfqs: RFQ[] }) {
  if (!rfqs || rfqs.length === 0) {
    return (
      <p className="mt-6 text-gray-500" data-testid="rfq-empty">
        No RFQs to display.
      </p>
    )
  }

  return (
    <section aria-label="RFQ Table" className="mt-6">
      <table className="w-full border-collapse border border-gray-300">
        <thead className="bg-gray-100">
          <tr>
            <th className="border border-gray-300 px-4 py-2 text-left font-semibold">ID</th>
            <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Title</th>
            <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Status</th>
            <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Created At</th>
            <th className="border border-gray-300 px-4 py-2 text-left font-semibold">Value</th>
          </tr>
        </thead>
        <tbody>
          {rfqs.map((rfq) => (
            <tr key={rfq.id} data-testid="rfq-row" className="hover:bg-gray-50">
              <td className="border border-gray-300 px-4 py-2 font-mono" data-testid={`rfq-id-${rfq.id}`}>
                {rfq.id}
              </td>
              <td className="border border-gray-300 px-4 py-2" data-testid={`rfq-title-${rfq.id}`}>
                {rfq.title}
              </td>
              <td className="border border-gray-300 px-4 py-2" data-testid={`rfq-status-${rfq.id}`}>
                <span className={`px-2 py-1 rounded text-sm font-medium ${
                  rfq.status === 'OPEN' ? 'bg-green-100 text-green-800' :
                  rfq.status === 'PENDING' ? 'bg-yellow-100 text-yellow-800' :
                  'bg-gray-100 text-gray-800'
                }`}>
                  {rfq.status}
                </span>
              </td>
              <td className="border border-gray-300 px-4 py-2 font-mono" data-testid={`rfq-createdAt-${rfq.id}`}>
                {rfq.createdAt && !Number.isNaN(new Date(rfq.createdAt).getTime())
                  ? new Date(rfq.createdAt).toLocaleDateString('en-US')
                  : '—'}
              </td>
              <td className="border border-gray-300 px-4 py-2 font-mono" data-testid={`rfq-value-${rfq.id}`}>
                {typeof rfq.value === 'number' && Number.isFinite(rfq.value)
                  ? rfq.value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
                  : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
