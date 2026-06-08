import { Metadata } from 'next'
import { RFQTable, type RFQ } from '@/components/rfq/RFQTable'

export const metadata: Metadata = {
  title: 'RFQ Dashboard | FlowSeer W251'
}

// Reads live data per request — never prerender at build time.
export const dynamic = 'force-dynamic'

export default async function RFQPage() {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'

  let rfqs: RFQ[] = []
  try {
    const response = await fetch(`${baseUrl}/api/rfq`, { cache: 'no-store' })
    if (response.ok) {
      // /api/rfq returns { data, total, page } — not a bare array.
      const payload = await response.json()
      rfqs = Array.isArray(payload?.data) ? payload.data : []
    }
  } catch {
    // Render the empty state rather than crashing the route on a fetch error.
    rfqs = []
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold text-gray-900 mb-6">RFQ Dashboard</h1>
      <RFQTable rfqs={rfqs} />
    </div>
  )
}
