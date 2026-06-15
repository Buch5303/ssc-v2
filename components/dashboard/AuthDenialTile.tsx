'use client';

import { useEffect, useState } from 'react';
import { KpiCard } from '@/components/cards/KpiCard';

interface DenialKPIs {
  total_denials: number;
  denials_today: number;
  top_denied_resource: string;
}

interface DenialEvent {
  audit_row_id: string;
  user_id: string;
  resource: string;
  timestamp: string;
}

interface SpikeEvent {
  count: number;
  window_start: string;
  window_end: string;
  audit_row_ids: string[];
}

export default function AuthDenialTile() {
  const [kpis, setKpis] = useState<DenialKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [spikeBanner, setSpikeBanner] = useState<{ count: number; visible: boolean } | null>(null);
  const [resourceCounts, setResourceCounts] = useState<Record<string, number>>({});
  const [eventSource, setEventSource] = useState<EventSource | null>(null);

  // Initialize KPI data from REST endpoint
  useEffect(() => {
    const fetchInitialData = async () => {
      try {
        const response = await fetch('/api/metrics/auth-denials');
        if (!response.ok) {
          throw new Error(`Failed to fetch initial data: ${response.status}`);
        }
        const data = await response.json();
        setKpis(data);
        
        // Initialize resource counts if we have initial data
        if (data.top_denied_resource) {
          setResourceCounts({ [data.top_denied_resource]: 1 });
        }
      } catch (err) {
        console.error('Failed to fetch initial denial metrics:', err);
        setError(err instanceof Error ? err.message : 'Failed to load data');
      } finally {
        setLoading(false);
      }
    };

    fetchInitialData();
  }, []);

  // Set up SSE connection
  useEffect(() => {
    if (loading || error) return;

    const es = new EventSource('/api/metrics/auth-denials/stream');
    setEventSource(es);

    // Handle denial events
    es.addEventListener('denial', (event) => {
      try {
        const denialEvent: DenialEvent = JSON.parse(event.data);
        
        // Update KPIs
        setKpis(prev => {
          if (!prev) return prev;
          
          const today = new Date().toDateString();
          const eventDate = new Date(denialEvent.timestamp).toDateString();
          const isDenialToday = today === eventDate;
          
          return {
            ...prev,
            total_denials: prev.total_denials + 1,
            denials_today: prev.denials_today + (isDenialToday ? 1 : 0)
          };
        });
        
        // Update resource counts and top denied resource
        setResourceCounts(prev => {
          const newCounts = {
            ...prev,
            [denialEvent.resource]: (prev[denialEvent.resource] || 0) + 1
          };
          
          // Find the resource with the highest count
          const topResource = Object.entries(newCounts).reduce((max, [resource, count]) => 
            count > max.count ? { resource, count } : max,
            { resource: '', count: 0 }
          );
          
          setKpis(prevKpis => {
            if (!prevKpis) return prevKpis;
            return {
              ...prevKpis,
              top_denied_resource: topResource.resource
            };
          });
          
          return newCounts;
        });
      } catch (err) {
        console.error('Failed to parse denial event:', err);
      }
    });

    // Handle spike events
    es.addEventListener('spike', (event) => {
      try {
        const spikeEvent: SpikeEvent = JSON.parse(event.data);
        setSpikeBanner({ count: spikeEvent.count, visible: true });
        
        // Auto-dismiss after 60 seconds
        setTimeout(() => {
          setSpikeBanner(prev => prev ? { ...prev, visible: false } : null);
        }, 60000);
      } catch (err) {
        console.error('Failed to parse spike event:', err);
      }
    });

    es.onerror = (event) => {
      console.error('SSE connection error:', event);
      // Don't set error state as this might be temporary
    };

    return () => {
      es.close();
      setEventSource(null);
    };
  }, [loading, error]);

  const dismissSpikeBanner = () => {
    setSpikeBanner(prev => prev ? { ...prev, visible: false } : null);
  };

  if (loading) {
    return (
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <div className="h-6 bg-muted rounded animate-pulse"></div>
        <div className="space-y-3">
          <div className="h-8 bg-muted rounded animate-pulse"></div>
          <div className="h-4 bg-muted rounded animate-pulse w-3/4"></div>
        </div>
        <div className="space-y-3">
          <div className="h-8 bg-muted rounded animate-pulse"></div>
          <div className="h-4 bg-muted rounded animate-pulse w-3/4"></div>
        </div>
        <div className="space-y-3">
          <div className="h-8 bg-muted rounded animate-pulse"></div>
          <div className="h-4 bg-muted rounded animate-pulse w-3/4"></div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-card border rounded-lg p-6">
        <div className="text-center text-muted-foreground">
          <p>Failed to load authorization denial metrics</p>
          <p className="text-sm mt-2">{error}</p>
        </div>
      </div>
    );
  }

  if (!kpis) {
    return (
      <div className="bg-card border rounded-lg p-6">
        <div className="text-center text-muted-foreground">
          No denial data available
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Spike Alert Banner */}
      {spikeBanner && spikeBanner.visible && (
        <div 
          role="alert" 
          className="bg-red-600 text-white px-4 py-2 rounded font-semibold flex justify-between items-center"
        >
          <span>Unusual denial spike detected — {spikeBanner.count} denials in 5 min</span>
          <button 
            onClick={dismissSpikeBanner}
            className="ml-4 px-2 py-1 bg-red-700 hover:bg-red-800 rounded text-sm"
            aria-label="Dismiss spike alert"
          >
            ✕
          </button>
        </div>
      )}
      
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard
          title="Total Denials"
          value={kpis.total_denials.toString()}
          subtitle="All time"
          className="bg-card border"
        />
        <KpiCard
          title="Denials Today"
          value={kpis.denials_today.toString()}
          subtitle="Since midnight"
          className="bg-card border"
        />
        <KpiCard
          title="Top Denied Resource"
          value={kpis.top_denied_resource || 'None'}
          subtitle="Most blocked"
          className="bg-card border"
        />
      </div>
      
      {/* Connection Status */}
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <div className={`w-2 h-2 rounded-full ${eventSource ? 'bg-green-500' : 'bg-red-500'}`}></div>
        {eventSource ? 'Real-time updates active' : 'Real-time updates disconnected'}
      </div>
    </div>
  );
}