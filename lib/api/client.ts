import axios from "axios";
import type { ApiEnvelope } from "@/lib/types/api";

export const http = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_BASE_URL,
  headers: { "Content-Type": "application/json" }
});

export function unwrapEnvelope<T>(payload: ApiEnvelope<T>): T {
  if (!payload.success) throw new Error(payload.error ?? "Unknown backend error");
  return payload.data;
}
