import { apiFetch } from './client';

export interface Wave9Status {
  status: string;
  contacts: {
    total: number;
    with_email: number;
    with_title: number;
    tagged: number;
    untagged: number;
    c_suite?: number;
    vp?: number;
  };
  apollo_upgrade_required: boolean;
}

export interface RfqQueueItem {
  id: number;
  supplier_name: string;
  contact_name: string;
  title: string;
  email: string;
  bop_category: string;
  seniority: string;
  category_mid_usd: number;
  rfq_status: string;
  action: string;
}

export interface RfqQueueResponse {
  total: number;
  not_started: number;
  drafted: number;
  sent: number;
  next: RfqQueueItem | null;
  queue: RfqQueueItem[];
}

export interface CategoryStat {
  category: string;
  contacts: number;
  with_email: number;
}

export interface SeniorityStat {
  seniority: string;
  contacts: number;
  with_email: number;
  bop_tagged: number;
}

export const fetchWave9Status  = () => apiFetch<Wave9Status>('/wave9/status');
export const fetchRfqQueue     = () => apiFetch<RfqQueueResponse>('/wave9/rfq-queue');
export const fetchByCategory   = () => apiFetch<{ categories: CategoryStat[] }>('/wave9/contacts/by-category');
export const fetchBySeniority  = () => apiFetch<{ by_seniority: SeniorityStat[] }>('/wave9/contacts/by-seniority');
