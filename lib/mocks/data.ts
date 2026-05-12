import type { ApiEnvelope } from "@/lib/types/api";

export const mockOk = <T>(data: T): ApiEnvelope<T> => ({ success: true, data, error: null });

export const mockDb = {
  health: { status: "ok", service: "fairchild-backend" },
  cj: { authorized: true, advertisers: [{ id: "cj-1", name: "Demo Advertiser" }], products: [{ sku: "P-1", title: "Wireless Mouse" }] },
  impact: { authorized: true, campaigns: [{ id: "100", name: "Summer Campaign" }], deals: [{ id: "d-1", title: "20% Off" }] },
  wordpress: { authorized: false },
  metricool: { authorized: true, profiles: [{ userId: "u1", blogId: "b1", name: "Brand Profile" }] },
  renderform: { authorized: true, templates: [{ id: "tpl_1", name: "Promo Template" }] }
};
