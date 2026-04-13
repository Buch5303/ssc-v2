import { apiFetch } from './client';

export interface ClaudeResult {
  id: number;
  analysis_type: string;
  subject_name: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  model_cost_usd: string;
  triggered_by: string;
  created_at: string;
  preview: string;
}

export interface ClaudeResultsResponse {
  results: ClaudeResult[];
  page: number;
  limit: number;
}

export const fetchClaudeResults = (limit = 5) =>
  apiFetch<ClaudeResultsResponse>(`/claude/results?limit=${limit}`);
