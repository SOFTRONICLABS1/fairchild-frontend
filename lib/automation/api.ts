import { http, unwrapEnvelope } from "@/lib/api/client";
import type { ApiEnvelope } from "@/lib/types/api";
import { getRenderBase } from "@/lib/api/render-engine";

export type ScheduleSettings = { enabled: boolean; daily_time: string; timezone: string };

export type ProductSettings = ScheduleSettings & {
  categories_per_day: number;
  products_per_category: number;
  min_discount: number;
  min_price: number;
  max_price: number;
  ignore_keywords: string;
  use_cj: boolean;
  use_impact: boolean;
  cj_advertiser_ids: string[];
  impact_campaign_ids: string[];
  claude_review: boolean;
  branded_image: boolean;
  template_id: string;
  exclude_category_ids: number[];
  publish_status: "publish" | "draft" | "pending";
};

export type BlogSettings = ScheduleSettings & {
  blogs_per_day: number;
  min_discount: number;
  topic_hint: string;
  publish_status: "publish" | "draft" | "pending";
};

export type AutomationSettings = { product: ProductSettings; blog: BlogSettings };

export type SourceOption = { id: string; name: string };
export type Sources = { cj: SourceOption[]; cj_error: string | null; impact: SourceOption[]; impact_error: string | null };

export type NextRun = { enabled: boolean; next_run_local: string; timezone: string; ran_today: boolean; retrying?: boolean };
export type AutomationStatus = {
  product: NextRun;
  blog: NextRun;
  categories: { synced_at?: string; total?: number; leaf_count?: number; missing?: boolean };
  product_cursor: number;
  scheduler_enabled: boolean;
};

export type RunSummary = Record<string, number | string | undefined>;
export type Run = {
  id: number;
  kind: "product" | "blog";
  status: "running" | "completed" | "partial" | "failed" | "interrupted" | "cancelled";
  trigger: "schedule" | "manual";
  dry_run: boolean;
  started_at: string;
  finished_at: string | null;
  summary: RunSummary;
  first_url?: string | null;
};
export type RunItem = {
  id: number;
  status: "created" | "skipped" | "error" | "warn" | "info" | "dry_run";
  category_name: string | null;
  message: string;
  ref_url: string | null;
};
export type RunDetail = Run & { items: RunItem[] };

export type CustomBlogDraft = { title: string; excerpt: string; content: string };
export type CustomBlogResult = { id: number | null; link: string | null; status: string };

export type RunRequest = { dry_run: boolean; max_categories?: number };

const base = "/api/v1/automation";

async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await http.get<ApiEnvelope<T>>(`${base}${path}`, { params });
  return unwrapEnvelope<T>(res.data);
}

export const automationApi = {
  settings: () => get<AutomationSettings>("/settings"),
  saveSettings: async (body: AutomationSettings) =>
    unwrapEnvelope<AutomationSettings>((await http.put<ApiEnvelope<AutomationSettings>>(`${base}/settings`, body)).data),
  status: () => get<AutomationStatus>("/status"),
  sources: (refresh = false) => get<Sources>("/sources", { refresh }),
  runs: (kind: "product" | "blog") => get<Run[]>("/runs", { kind, limit: 100 }),
  run: (id: number) => get<RunDetail>(`/runs/${id}`),
  start: async (kind: "product" | "blog", body: RunRequest) =>
    unwrapEnvelope<{ run_id: number; dry_run: boolean }>(
      (await http.post<ApiEnvelope<{ run_id: number; dry_run: boolean }>>(`${base}/${kind}/run`, body)).data
    ),
  cancel: async (id: number) =>
    unwrapEnvelope<{ run_id: number; cancelling: boolean }>(
      (await http.post<ApiEnvelope<{ run_id: number; cancelling: boolean }>>(`${base}/runs/${id}/cancel`, {})).data
    ),
  customBlogGenerate: async (prompt: string) =>
    unwrapEnvelope<CustomBlogDraft>((await http.post<ApiEnvelope<CustomBlogDraft>>(`${base}/blog/custom/generate`, { prompt })).data),
  customBlogPublish: async (body: CustomBlogDraft & { status: "publish" | "draft" | "pending" }) =>
    unwrapEnvelope<CustomBlogResult>((await http.post<ApiEnvelope<CustomBlogResult>>(`${base}/blog/custom/publish`, body)).data),
  syncCategories: async () =>
    unwrapEnvelope<{ total: number; leaf_count: number; synced_at: string }>(
      (await http.post<ApiEnvelope<{ total: number; leaf_count: number; synced_at: string }>>(`${base}/categories/sync`, {})).data
    ),
  templates: async () => {
    const res = await http.get<ApiEnvelope<Array<{ identifier: string; name: string; preview?: string }>>>(`${await getRenderBase()}/templates`);
    return unwrapEnvelope(res.data);
  }
};
