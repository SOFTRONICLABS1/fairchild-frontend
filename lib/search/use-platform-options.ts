"use client";

import { useEffect, useState } from "react";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getDisplayMessage } from "@/lib/api/errors";

export type AdvertiserOption = { value: string; label: string };
export type CampaignOption = { value: string; label: string; catalogIds: string[] };

const CJ_CACHE_KEY = "search:cj-advertisers:v1";
export const IMPACT_CAMPAIGN_MAP_KEY = "search:impact-campaign-map";

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
 * each paying for the lookup (the Impact one pages through every catalog).
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

    const cachedMap = readCache<Record<string, string[]>>(IMPACT_CAMPAIGN_MAP_KEY);
    if (cachedMap && Object.keys(cachedMap).length > 0) {
      setImpactCampaigns(
        Object.entries(cachedMap)
          .map(([name, catalogIds]) => ({ value: name, label: name, catalogIds }))
          .sort((a, b) => a.label.localeCompare(b.label))
      );
      return;
    }

    const load = async () => {
      setImpactLoading(true);
      setImpactError(null);
      try {
        const limit = 20;
        let offset = 0;
        const campaignMap = new Map<string, Set<string>>();
        // The catalogs endpoint pages 20 at a time and there is no campaign-level list,
        // so every page has to be walked to build the campaign -> catalogIds map.
        while (true) {
          const response = await http.get("/api/v1/impact/catalogs", { params: { limit, offset } });
          const data = unwrapEnvelope<{ Catalogs?: Array<{ Id?: string; CampaignName?: string }> }>(response.data);
          const catalogs = Array.isArray(data.Catalogs) ? data.Catalogs : [];
          catalogs.forEach((catalog) => {
            const campaignName = String(catalog.CampaignName ?? "").trim();
            const catalogId = String(catalog.Id ?? "").trim();
            if (!campaignName || !catalogId) return;
            if (!campaignMap.has(campaignName)) campaignMap.set(campaignName, new Set());
            campaignMap.get(campaignName)?.add(catalogId);
          });
          if (catalogs.length < limit) break;
          offset += limit;
        }

        const options = Array.from(campaignMap.entries())
          .map(([name, ids]) => ({ value: name, label: name, catalogIds: Array.from(ids) }))
          .sort((a, b) => a.label.localeCompare(b.label));
        if (cancelled) return;
        setImpactCampaigns(options);
        writeCache(
          IMPACT_CAMPAIGN_MAP_KEY,
          options.reduce<Record<string, string[]>>((acc, item) => {
            acc[item.value] = item.catalogIds;
            return acc;
          }, {})
        );
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
