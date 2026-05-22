import axios from "axios";
import type { ApiEnvelope } from "@/lib/types/api";
import type { NormalizedApiError } from "@/lib/types/api";

export const http = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
  headers: { "Content-Type": "application/json" }
});

function normalizeErrorPayload(input: unknown): {
  code?: string;
  message: string;
  retryable?: boolean;
  step?: string;
  details?: unknown;
} {
  if (!input || typeof input !== "object") {
    return { message: "Unknown backend error" };
  }
  const payload = input as {
    message?: string;
    code?: string;
    retryable?: boolean;
    step?: string;
    details?: unknown;
    error?: unknown;
  };
  if (payload.error && typeof payload.error === "object") {
    return normalizeErrorPayload(payload.error);
  }
  return {
    code: payload.code,
    message: payload.message ?? "Unknown backend error",
    retryable: payload.retryable,
    step: payload.step,
    details: payload.details
  };
}

function toNormalizedError(error: unknown): NormalizedApiError {
  const fallback = new Error("Request failed") as NormalizedApiError;
  if (!error || typeof error !== "object") return fallback;

  const axiosError = error as {
    message?: string;
    response?: {
      status?: number;
      data?: unknown;
    };
  };
  const payloadFromResponse = normalizeErrorPayload(axiosError.response?.data);
  const payload = payloadFromResponse.message !== "Unknown backend error"
    ? payloadFromResponse
    : normalizeErrorPayload(error);

  const normalized = new Error(payload.message || axiosError.message || "Request failed") as NormalizedApiError;
  normalized.code = payload.code;
  normalized.retryable = payload.retryable;
  normalized.step = payload.step;
  normalized.details = payload.details;
  normalized.status = axiosError.response?.status;
  return normalized;
}

http.interceptors.response.use(
  (response) => response,
  (error) => Promise.reject(toNormalizedError(error))
);

export function unwrapEnvelope<T>(payload: ApiEnvelope<T>): T {
  if (!payload.success) {
    const envelopeError = toNormalizedError(payload);
    envelopeError.message = payload.error ?? envelopeError.message ?? "Unknown backend error";
    throw envelopeError;
  }
  return payload.data;
}
