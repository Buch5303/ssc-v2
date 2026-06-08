import { db } from '@/lib/db';
import { rfqRequests } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { Suspense } from 'react';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function RFQDetailSkeleton() {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="h-4 bg-muted animate-pulse rounded mb-6 w-32"></div>
      <div className="h-96 bg-muted animate-pulse rounded"></div>
      <div className="h-4 bg-muted animate-pulse rounded mt-4 w-3/4"></div>
    </div>
  );
}

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

function formatCurrency(value: number | string, currency: string = 'USD'): string {
  const numValue = typeof value === 'string' ? parseFloat(value) : value;
  if (isNaN(numValue)) return '—';
  
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(numValue);
}

function formatDate(date: string | Date): string {
  if (!date) return '—';
  
  const dateObj = typeof date === 'string' ? new Date(date) : date;
  if (isNaN(dateObj.getTime())) return '—';
  
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(dateObj);
}

async function RFQDetailContent({ id }: { id: string }) {
  if (!UUID_REGEX.test(id)) {
    notFound();
  }

  const record = await db
    .select()
    .from(rfqRequests)
    .where(eq(rfqRequests.id, id))
    .limit(1);

  if (record.length === 0) {
    notFound();
  }

  const rfq = record[0];

  return (
    <article role="region" aria-label="RFQ Detail" className="bg-card border border-border rounded-lg p-6">
      <header className="border-b border-border pb-4 mb-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-fg">
            {rfq.rfq_number || 'Untitled RFQ'}
          </h1>
          <span
            className={`px-3 py-1 rounded-full text-sm font-medium border ${
              getStatusBadgeClass(rfq.status || 'draft')
            }`}
          >
            {rfq.status || 'Draft'}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Vendor Name
            </label>
            <p className="text-fg">{rfq.vendor_name || '—'}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Issue Date
            </label>
            <p className="text-fg font-mono">{formatDate(rfq.issue_date)}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Due Date
            </label>
            <p className="text-fg font-mono">{formatDate(rfq.due_date)}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Category
            </label>
            <p className="text-fg">{rfq.category || '—'}</p>
          </div>
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Estimated Value
            </label>
            <p className="text-fg font-mono text-lg font-semibold">
              {formatCurrency(rfq.estimated_value || 0, rfq.currency || 'USD')}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Currency
            </label>
            <p className="text-fg">{rfq.currency || '—'}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Created
            </label>
            <p className="text-fg font-mono text-sm">{formatDate(rfq.created_at)}</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Updated
            </label>
            <p className="text-fg font-mono text-sm">{formatDate(rfq.updated_at)}</p>
          </div>
        </div>
      </div>

      {rfq.description && (
        <div className="mt-6 pt-6 border-t border-border">
          <label className="block text-sm font-medium text-muted-foreground mb-2">
            Description
          </label>
          <div className="text-fg whitespace-pre-wrap bg-muted/50 p-4 rounded-md">
            {rfq.description}
          </div>
        </div>
      )}
    </article>
  );
}

export default async function RFQDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="max-w-4xl mx-auto p-6">
      <Link
        href="/rfq"
        className="inline-flex items-center text-accent hover:text-accent/80 mb-6 transition-colors"
      >
        &larr; Back to RFQ List
      </Link>

      <Suspense fallback={<RFQDetailSkeleton />}>
        <RFQDetailContent id={params.id} />
      </Suspense>
    </div>
  );
}