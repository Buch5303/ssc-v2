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
  outreach_id: number | null;
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

export interface Wave9ContactsByCategory {
  categories: CategoryStat[];
}

export interface Wave9ContactsBySeniority {
  by_seniority: SeniorityStat[];
}
