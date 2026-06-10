import { db } from '@/lib/db';
import { rfqs as rfqsTable } from '@/lib/db/schema';
import { desc } from 'drizzle-orm';
import Link from 'next/link';

// Derived from the REAL drizzle schema row — extra display fields optional.
// (Same AUTO-037 type-error fix as app/rfq/[id]/page.tsx, 2026-06-10.)
type RfqRow = typeof rfqsTable.$inferSelect;
type RfqView = RfqRow & {
  title?: string | null;
  createdAt?: Date | string | null;
  updatedAt?: Date | string | null;
  rfq_number?: string | null;
  vendor_name?: string | null;
  due_date?: string | Date | null;
  category?: string | null;
  currency?: string | null;
  estimated_value?: number | string | null;
};

export const dynamic = 'force-dynamic';

function getStatusBadgeClass(status: string): string {
  switch (status?.toLowerCase()) {
    case 'draft':
      return 'bg-gray-100 text-gray-800 border-gray-300';
    case 'published':
      return 'bg-blue-100 text-blue-800 border-blue-300';
    case 'awarded':
      return 'bg-green-100 text-green-800 border-green-300';
    case 'cancelled':
      return 'bg-red-100 text-red-800 border-red-300';
    default:
      return 'bg-gray-100 text-gray-800 border-gray-300';
  }
}

function formatCurrency(value?: number | string | null, currency: string = 'USD'): string {
  const numValue = typeof value === 'string' ? parseFloat(value) : (value ?? NaN);
  if (isNaN(numValue)) return '—';
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
}

function formatDate(date?: string | Date | null): string {
  if (!date) return '—';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '—';
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(dateObj);
}

export default async function RFQListPage() {
  const rfqs = await db
    .select()
    .from(rfqsTable)
    .orderBy(desc(rfqsTable.updated_at));

  return (
    <div className="max-w-7xl mx-auto p-6">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-fg">RFQ Management</h1>
        <Link
          href="/rfq/new"
          className="bg-accent text-accent-foreground px-4 py-2 rounded-md hover:bg-accent/90 transition-colors"
        >
          Create RFQ
        </Link>
      </div>

      <div className="bg-card border border-border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50 border-b border-border">
              <tr>
                <th className="text-left p-4 font-medium text-muted-foreground">RFQ Number</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Vendor</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Due Date</th>
                <th className="text-right p-4 font-medium text-muted-foreground">Est. Value</th>
                <th className="text-left p-4 font-medium text-muted-foreground">Category</th>
              </tr>
            </thead>
            <tbody>
              {rfqs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-12 text-muted-foreground">
                    No RFQ requests found. Create your first RFQ to get started.
                  </td>
                </tr>
              ) : (
                rfqs.map((rfq: RfqView) => (
                  <tr key={rfq.id} className="border-b border-border hover:bg-muted/25 transition-colors">
                    <td className="p-4">
                      <Link
                        href={`/rfq/${rfq.id}`}
                        className="font-medium text-accent hover:text-accent/80 transition-colors"
                      >
                        {rfq.rfq_number || 'Untitled'}
                      </Link>
                    </td>
                    <td className="p-4 text-fg">{rfq.vendor_name || '—'}</td>
                    <td className="p-4">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium border ${
                          getStatusBadgeClass(rfq.status || 'draft')
                        }`}
                      >
                        {rfq.status || 'Draft'}
                      </span>
                    </td>
                    <td className="p-4 text-fg font-mono text-sm">{formatDate(rfq.due_date)}</td>
                    <td className="p-4 text-right text-fg font-mono">
                      {formatCurrency(rfq.estimated_value || 0, rfq.currency || 'USD')}
                    </td>
                    <td className="p-4 text-fg">{rfq.category || '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}