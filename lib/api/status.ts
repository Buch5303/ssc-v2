import { apiFetch } from './client';

export interface StatusResponse {
  platform: string;
  head: string;
  db: { online: boolean; counts: Record<string, number> };
  engines: {
    discovery: { status: string };
    claude: { status: string; model: string; analyses_run: number };
    perplexity: { status: string; checks_run: number };
  };
  bop_intelligence: {
    suppliers_in_db: number;
    pricing_records: number;
    bop_total_mid_usd: number;
    bop_categories_priced: number;
  };
  wave9_readiness: {
    contacts_in_db: number;
    outreach_records: number;
    apollo_upgrade_required: boolean;
  };
  audit_endpoints: Record<string, string>;
}

export const fetchStatus = () => apiFetch<StatusResponse>('/status');
