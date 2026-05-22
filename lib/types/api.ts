export interface ApiEnvelope<T> { success: boolean; data: T; error: string | null; }
export interface ApiError { message: string; status?: number; }
export interface HistoryItem { timestamp: string; action: string; request: unknown; response?: unknown; error?: string; }

export type NormalizedApiError = Error & {
  code?: string;
  retryable?: boolean;
  step?: string;
  status?: number;
  details?: unknown;
};
