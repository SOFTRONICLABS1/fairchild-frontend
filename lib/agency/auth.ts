"use client";

export const AGENCY_AUTH_SESSION_KEY = "agency:auth";
export const AGENCY_SELECTED_BRAND_KEY = "agency:selected-brand";

export type AgencyAuthUser = {
  id: string;
  email: string;
  role?: string | null;
  brand_id?: string | null;
  is_active?: boolean;
  name?: string | null;
  company?: string | null;
  plan?: string | null;
};

export type AgencyAuthSession = {
  accessToken: string;
  tokenType: string;
  user: AgencyAuthUser;
};

export function loadAgencyAuth(): AgencyAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(AGENCY_AUTH_SESSION_KEY);
    return raw ? (JSON.parse(raw) as AgencyAuthSession) : null;
  } catch {
    return null;
  }
}

export function saveAgencyAuth(session: AgencyAuthSession) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AGENCY_AUTH_SESSION_KEY, JSON.stringify(session));
}

export function clearAgencyAuth() {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(AGENCY_AUTH_SESSION_KEY);
  sessionStorage.removeItem(AGENCY_SELECTED_BRAND_KEY);
}

export function loadSelectedBrandId(): string {
  if (typeof window === "undefined") return "";
  return sessionStorage.getItem(AGENCY_SELECTED_BRAND_KEY) ?? "";
}

export function saveSelectedBrandId(brandId: string) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AGENCY_SELECTED_BRAND_KEY, brandId);
}
