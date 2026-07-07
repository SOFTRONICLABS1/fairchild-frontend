"use client";

import axios from "axios";
import type { AgencyAuthSession } from "@/lib/agency/auth";

const agencyHttp = axios.create({
  baseURL: process.env.NEXT_PUBLIC_AGENCY_API_BASE_URL ?? "https://api.loclshop.com",
  headers: {
    "Content-Type": "application/json",
    accept: "application/json"
  }
});

export type AgencyBrand = {
  id: string;
  name: string;
  url?: string | null;
};

export type AgencyLocation = {
  id: string;
  brand_id: string;
  name: string;
  url?: string | null;
  address_line1?: string | null;
  city?: string | null;
  region?: string | null;
  postal_code?: string | null;
};

export type AgencyAssessmentPrompt = {
  id: string;
  prompt: string;
};

export async function loginAgencyUser(email: string, password: string): Promise<AgencyAuthSession> {
  const response = await agencyHttp.post("/api/v1/auth/login", { email, password });
  const payload = response.data as {
    access_token?: string;
    token_type?: string;
    user?: AgencyAuthSession["user"];
  };
  if (!payload.access_token || !payload.user) {
    throw new Error("Login response did not include an access token");
  }
  return {
    accessToken: payload.access_token,
    tokenType: payload.token_type ?? "bearer",
    user: payload.user
  };
}

export async function fetchAgencyBrands(accessToken: string): Promise<AgencyBrand[]> {
  const pageSize = 20;
  const items: AgencyBrand[] = [];
  let page = 1;

  while (true) {
    const response = await agencyHttp.get("/api/v1/brands", {
      params: { include_inactive: false, page, page_size: pageSize },
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const payload = response.data as {
      items?: Array<{ id?: string; name?: string; url?: string | null }>;
    };
    const pageItems = Array.isArray(payload.items) ? payload.items : [];
    items.push(
      ...pageItems
        .map((item) => ({
          id: String(item.id ?? "").trim(),
          name: String(item.name ?? "").trim(),
          url: item.url ?? null
        }))
        .filter((item) => item.id && item.name)
    );

    if (pageItems.length < pageSize) break;
    page += 1;
  }

  return items;
}

export async function fetchAgencyLocations(accessToken: string, brandId: string): Promise<AgencyLocation[]> {
  const response = await agencyHttp.get(`/api/v1/aeo/brands/${brandId}/locations`, {
    params: { limit: 50 },
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const payload = response.data as {
    locations?: Array<{
      id?: string;
      brand_id?: string;
      name?: string;
      url?: string | null;
      address_line1?: string | null;
      city?: string | null;
      region?: string | null;
      postal_code?: string | null;
    }>;
  };
  const items = Array.isArray(payload.locations) ? payload.locations : [];
  return items
    .map((item) => ({
      id: String(item.id ?? "").trim(),
      brand_id: String(item.brand_id ?? "").trim(),
      name: String(item.name ?? "").trim(),
      url: item.url ?? null,
      address_line1: item.address_line1 ?? null,
      city: item.city ?? null,
      region: item.region ?? null,
      postal_code: item.postal_code ?? null
    }))
    .filter((item) => item.id && item.name);
}

export async function fetchAgencyAssessmentPrompts(
  accessToken: string,
  brandId: string,
  locationId: string
): Promise<AgencyAssessmentPrompt[]> {
  const response = await agencyHttp.get(`/api/v1/aeo/brands/${brandId}/locations/${locationId}/assessment`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  const payload = response.data as {
    data?: {
      prompts?: Array<{
        id?: string;
        prompt?: string | null;
      }>;
    };
  };

  const prompts = Array.isArray(payload.data?.prompts) ? payload.data?.prompts : [];
  return prompts
    .map((item, index) => ({
      id: String(item.id ?? `prompt-${index + 1}`).trim(),
      prompt: String(item.prompt ?? "").trim()
    }))
    .filter((item) => item.prompt);
}
