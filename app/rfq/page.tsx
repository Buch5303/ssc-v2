import { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'RFQ Dashboard | FlowSeer W251'
}

interface RFQ {
  id: string
  title: string
  status: string
  created_at: string
  value: number
}

export function RFQTable({ rfqs }: { rfqs: RFQ[] }) {
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
              <td className="border border-gray-300 px-4 py-2 font-mono" data-testid={`rfq-created_at-${rfq.id}`}>
                {new Date(rfq.created_at).toLocaleDateString('en-US')}
              </td>
              <td className="border border-gray-300 px-4 py-2 font-mono" data-testid={`rfq-value-${rfq.id}`}>
                {rfq.value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

export default async function RFQPage() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'
  
  try {
    const response = await fetch(`${baseUrl}/api/rfq`, {
      cache: 'no-store'
    })
    
    if (!response.ok) {
      throw new Error(response.statusText || 'Failed to fetch RFQ data')
    }
    
    const rfqs: RFQ[] = await response.json()
    
    return (
      <div className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-6">RFQ Dashboard</h1>
        <RFQTable rfqs={rfqs} />
      </div>
    )
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Failed to fetch RFQ data')
  }
}