"use client";

import { useEffect, useState } from "react";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getDisplayMessage } from "@/lib/api/errors";

export type AdvertiserOption = { value: string; label: string };
export type CampaignOption = { value: string; label: string };

const CJ_CACHE_KEY = "search:cj-advertisers:v1";
const IMPACT_CAMPAIGN_CACHE_KEY = "search:impact-campaigns:v2";

type CjLookupPayload = {
  "cj-api"?: {
    advertisers?: {
      advertiser?:
        | Array<{ "advertiser-id"?: string; "advertiser-name"?: string }>
        | { "advertiser-id"?: string; "advertiser-name"?: string };
    };
  };
};

function readCache<T>(key: string): T | null {
  try {
    const raw = sessionStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeCache(key: string, value: unknown) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or unavailable; the list simply refetches next time
  }
}

/**
 * Loads the joined CJ advertisers and Impact campaigns once per session and caches them,
 * so the search page and the results sidebar can both render the same pickers without
 * each paying for the lookup.
 */
export function usePlatformOptions(enabled: { cj: boolean; impact: boolean }) {
  const [cjAdvertisers, setCjAdvertisers] = useState<AdvertiserOption[]>([]);
  const [cjLoading, setCjLoading] = useState(false);
  const [cjError, setCjError] = useState<string | null>(null);

  const [impactCampaigns, setImpactCampaigns] = useState<CampaignOption[]>([]);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impactError, setImpactError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled.cj) return;
    let cancelled = false;

    const cached = readCache<AdvertiserOption[]>(CJ_CACHE_KEY);
    if (cached?.length) {
      setCjAdvertisers(cached);
      return;
    }

    const load = async () => {
      setCjLoading(true);
      setCjError(null);
      try {
        const response = await http.get("/api/v1/cj/advertisers/lookup", {
          params: {
            "requestor-cid": "6947255",
            "advertiser-ids": "joined",
            "response-format": "json"
          }
        });
        const data = unwrapEnvelope<CjLookupPayload>(response.data);
        const raw = data?.["cj-api"]?.advertisers?.advertiser;
        const list = Array.isArray(raw) ? raw : raw ? [raw] : [];
        const normalized = list
          .map((item) => ({
            value: String(item["advertiser-id"] ?? "").trim(),
            label: String(item["advertiser-name"] ?? "").trim()
          }))
          .filter((item) => item.value && item.label)
          .sort((a, b) => a.label.localeCompare(b.label));
        if (cancelled) return;
        setCjAdvertisers(normalized);
        writeCache(CJ_CACHE_KEY, normalized);
      } catch (error) {
        if (!cancelled) setCjError(getDisplayMessage(error) || "Failed to load CJ advertisers");
      } finally {
        if (!cancelled) setCjLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled.cj]);

  useEffect(() => {
    if (!enabled.impact) return;
    let cancelled = false;

    const cached = readCache<CampaignOption[]>(IMPACT_CAMPAIGN_CACHE_KEY);
    if (cached?.length) {
      setImpactCampaigns(cached);
      return;
    }

    const load = async () => {
      setImpactLoading(true);
      setImpactError(null);
      try {
        const limit = 100;
        let offset = 0;
        const byId = new Map<string, string>();
        // Impact's /Catalogs listing returns an empty set for this account even though the
        // catalog items exist, so the advertiser picker is built from /Campaigns instead and
        // item queries are scoped by CampaignId.
        while (true) {
          const response = await http.get("/api/v1/impact/campaigns", { params: { limit, offset } });
          const data = unwrapEnvelope<{
            Campaigns?: Array<{ CampaignId?: string; CampaignName?: string; ContractStatus?: string }>;
          }>(response.data);
          const campaigns = Array.isArray(data.Campaigns) ? data.Campaigns : [];
          campaigns.forEach((campaign) => {
            const campaignId = String(campaign.CampaignId ?? "").trim();
            const campaignName = String(campaign.CampaignName ?? "").trim();
            if (!campaignId || !campaignName) return;
            // Expired contracts still come back from /Campaigns but their catalogs are gone,
            // so listing them would only offer advertisers that can never return a product.
            if (String(campaign.ContractStatus ?? "").trim().toLowerCase() !== "active") return;
            byId.set(campaignId, campaignName);
          });
          if (campaigns.length < limit) break;
          offset += limit;
        }

        const options = Array.from(byId.entries())
          .map(([value, label]) => ({ value, label }))
          .sort((a, b) => a.label.localeCompare(b.label));
        if (cancelled) return;
        setImpactCampaigns(options);
        writeCache(IMPACT_CAMPAIGN_CACHE_KEY, options);
      } catch (error) {
        if (!cancelled) setImpactError(getDisplayMessage(error) || "Failed to load Impact campaigns");
      } finally {
        if (!cancelled) setImpactLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [enabled.impact]);

  return { cjAdvertisers, cjLoading, cjError, impactCampaigns, impactLoading, impactError };
}
