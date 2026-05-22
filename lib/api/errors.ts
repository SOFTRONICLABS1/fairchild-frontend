import type { NormalizedApiError } from "@/lib/types/api";

const ERROR_MESSAGES: Record<string, string> = {
  RENDER_TIMEOUT: "Image editing timed out. Please retry.",
  MEDIA_UPLOAD_INVALID_INPUT: "Image upload input is invalid. Please retry with a different product image.",
  WORDPRESS_CREATE_FAILED: "WordPress product creation failed. Please retry.",
  METRICOOL_SCHEDULE_FAILED: "Metricool scheduling failed. Please retry.",
  IMAGE_INVALID_OR_BLANK: "Product image is invalid or blank. Please choose another product.",
  UPSTREAM_RATE_LIMITED: "Rate limit reached. Please wait and retry.",
  INVALID_KEYWORD_FORMAT: "Enter related keyword. URLs are not supported for keyword search."
};

export function normalizeApiError(error: unknown): NormalizedApiError {
  const fallback = new Error("Request failed") as NormalizedApiError;
  if (!error || typeof error !== "object") return fallback;
  const anyError = error as {
    message?: string;
    code?: string;
    retryable?: boolean;
    step?: string;
    status?: number;
    details?: unknown;
  };
  const normalized = new Error(anyError.message ?? "Request failed") as NormalizedApiError;
  normalized.code = anyError.code;
  normalized.retryable = anyError.retryable;
  normalized.step = anyError.step;
  normalized.status = anyError.status;
  normalized.details = anyError.details;
  return normalized;
}

export function getDisplayMessage(error: unknown): string {
  const normalized = normalizeApiError(error);
  if (normalized.code && ERROR_MESSAGES[normalized.code]) {
    return ERROR_MESSAGES[normalized.code];
  }
  return normalized.message || "Request failed";
}

export function getErrorMeta(error: unknown): {
  message: string;
  code?: string;
  retryable: boolean;
  step?: string;
  status?: number;
} {
  const normalized = normalizeApiError(error);
  return {
    message: getDisplayMessage(normalized),
    code: normalized.code,
    retryable: Boolean(normalized.retryable),
    step: normalized.step,
    status: normalized.status
  };
}
