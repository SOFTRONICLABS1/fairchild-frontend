import { http, unwrapEnvelope } from "@/lib/api/client";
import type { ApiEnvelope } from "@/lib/types/api";

export type ReviewItem = { id: string; title: string; brand?: string; description?: string; image_text?: string; caption?: string; url?: string; price?: number; discount?: number; platform?: string };
export type ReviewVerdict = { id: string; verdict: "approve" | "reject"; reason: string; source: "keyword" | "claude" | "error" };

const base = "/api/v1/review";
const OVERRIDES_KEY = "pipeline:review-overrides";

export const reviewApi = {
  products: async (items: ReviewItem[]) =>
    unwrapEnvelope<ReviewVerdict[]>((await http.post<ApiEnvelope<ReviewVerdict[]>>(`${base}/products`, { items })).data),
  keywords: async () => unwrapEnvelope<{ keywords: string[] }>((await http.get<ApiEnvelope<{ keywords: string[] }>>(`${base}/keywords`)).data),
  saveKeywords: async (keywords: string) =>
    unwrapEnvelope<{ keywords: string[] }>((await http.put<ApiEnvelope<{ keywords: string[] }>>(`${base}/keywords`, { keywords })).data)
};

/** Products the user chose to post anyway. Kept for the browser session only. */
export function loadOverrides(): Record<string, boolean> {
  try {
    return JSON.parse(sessionStorage.getItem(OVERRIDES_KEY) ?? "{}") as Record<string, boolean>;
  } catch {
    return {};
  }
}

export function saveOverrides(next: Record<string, boolean>) {
  try {
    sessionStorage.setItem(OVERRIDES_KEY, JSON.stringify(next));
  } catch {
    /* session storage unavailable: the override just lasts until the page reloads */
  }
}
