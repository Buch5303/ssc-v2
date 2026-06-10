import { Suspense } from 'react';
import Link from 'next/link';
import { KpiCard } from '@/components/cards/KpiCard';
import { AlertCard } from '@/components/ui/AlertCard';
import { Skeletons } from '@/components/ui/Skeletons';
import NavTimingGuard from './_components/NavTimingGuard';

export default function DashboardPage() {
  return (
    <div className="space-y-6">
      <NavTimingGuard />
      
      {/* Header */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h1 className="text-2xl font-semibold text-fg mb-2">
          W251 BOP Dashboard
        </h1>
        <p className="text-muted">
          Real-time procurement intelligence and risk monitoring
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Suspense fallback={<Skeletons.Card />}>
          <KpiCard
            title="Active RFQs"
            value="12"
            trend="+8.3%"
            isPositive={true}
          />
        </Suspense>
        <Suspense fallback={<Skeletons.Card />}>
          <KpiCard
            title="Cost Savings"
            value="$2.4M"
            trend="+15.2%"
            isPositive={true}
          />
        </Suspense>
        <Suspense fallback={<Skeletons.Card />}>
          <KpiCard
            title="Supplier Score"
            value="94.2"
            trend="+2.1%"
            isPositive={true}
          />
        </Suspense>
        <Suspense fallback={<Skeletons.Card />}>
          <KpiCard
            title="Risk Level"
            value="Low"
            trend="-5.8%"
            isPositive={true}
          />
        </Suspense>
      </div>

      {/* Alerts Section */}
      <div className="bg-card rounded-lg border border-border p-6">
        <h2 className="text-xl font-semibold text-fg mb-4">
          Priority Alerts
        </h2>
        <div className="space-y-3">
          <AlertCard
            type="warning"
            title="Supplier Risk Increase"
            message="Acme Corp risk score increased to 7.2 (threshold: 7.0)"
            timestamp="2 minutes ago"
          />
          <AlertCard
            type="info"
            title="New RFQ Submitted"
            message="RFQ-2024-0892 submitted for Electronics Components"
            timestamp="5 minutes ago"
          />
        </div>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link href="/dashboard/rfq-pipeline" className="block">
          <div className="bg-card rounded-lg border border-border p-6 hover:bg-accent/50 transition-colors">
            <h3 className="text-lg font-semibold text-fg mb-2">
              RFQ Pipeline
            </h3>
            <p className="text-muted">
              Monitor active requests and supplier responses
            </p>
          </div>
        </Link>
        
        <Link href="/dashboard/cost-intel" className="block">
          <div className="bg-card rounded-lg border border-border p-6 hover:bg-accent/50 transition-colors">
            <h3 className="text-lg font-semibold text-fg mb-2">
              Cost Intelligence
            </h3>
            <p className="text-muted">
              Analyze pricing trends and cost optimization opportunities
            </p>
          </div>
        </Link>
        
        <Link href="/dashboard/supplier-network" className="block">
          <div className="bg-card rounded-lg border border-border p-6 hover:bg-accent/50 transition-colors">
            <h3 className="text-lg font-semibold text-fg mb-2">
              Supplier Network
            </h3>
            <p className="text-muted">
              Manage supplier relationships and performance metrics
            </p>
          </div>
        </Link>
      </div>
    </div>
  );
}