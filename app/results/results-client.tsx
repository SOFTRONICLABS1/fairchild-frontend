"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getErrorMeta } from "@/lib/api/errors";
import DealsPanel from "@/components/search/deals-panel";
import MultiSelectChips from "@/components/search/multi-select-chips";
import { usePlatformOptions } from "@/lib/search/use-platform-options";
import {
  applyIntent,
  clearIntentKey,
  describeIntent,
  readIntentFromParams,
  readSelectionParam,
  writeSelectionParam,
  toCjBody,
  toImpactParams,
  writeIntentToParams,
  type SearchIntent
} from "@/lib/search/intent";

const PAGE_SIZE = 50;
const API_PAGE_LIMIT = 100;
// Pages fill themselves: keep fetching every couple of seconds until the current page
// holds PAGE_SIZE rows. There is no manual trigger, so the only stopping conditions are
// a full page, the platforms running out, an error, or a stall (see AUTO_LOAD_STALL_LIMIT).
const AUTO_LOAD_DELAY_MS = 2000;
// Consecutive fetches that add nothing usable. Without this a filter that the client
// prunes to zero (junk rows, failed link validation) would page forever with no gain.
const AUTO_LOAD_STALL_LIMIT = 3;
const IMPACT_CATALOG_BY_KEYWORD_LIMIT = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const ENABLE_RESULTS_CACHE = true;
const ENABLE_CJ_LINK_VALIDATION = true;
const CJ_VALIDATION_BATCH_SIZE = 8;
const CJ_URL_HEALTH_CACHE_KEY = "results:cj-url-health:v1";
const BARSE_CAMPAIGN_NAME = "barse jewelry";
const IMPACT_BARSE_VALIDATION_BATCH_SIZE = 8;
const impactHealthCache = new Map<string, boolean>();
type ImpactValidationQueueItem = {
  rowId: string;
  imageUrl: string;
  epoch: number;
};

type ResultRow = {
  rowKey: string;
  id: string;
  product: string;
  companyName: string;
  campaignId?: string;
  imageUrl: string;
  /** Primary + alternate image URLs; the pipeline falls back through these if one is dead. */
  imageCandidates: string[];
  productUrl: string;
  platform: "CJ" | "Impact";
  price: number;
  discount: number;
};

type CjProduct = {
  id: string;
  catalogId?: string;
  title: string;
  advertiserName?: string;
  link: string;
  linkCode?: {
    clickUrl?: string;
  };
  imageLink: string;
  additionalImageLink?: string | string[] | null;
  price?: { amount?: string | number | null } | null;
  salePrice?: { amount?: string | number | null } | null;
};

type ImpactItem = {
  Id: string;
  CatalogId?: string;
  CampaignId?: string;
  Name: string;
  CampaignName?: string;
  Url?: string;
  ImageUrl: string;
  AdditionalImageUrls?: string[] | string | null;
  IsParent?: boolean;
  CurrentPrice?: string | number | null;
  OriginalPrice?: string | number | null;
};

/** Builds a deduped list of usable https image URLs: primary first, then alternates. */
function buildImageCandidates(primary: string, additional?: string[] | string | null): string[] {
  const raw = [primary, ...(Array.isArray(additional) ? additional : additional ? [additional] : [])];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of raw) {
    const url = String(value ?? "").trim();
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

type ImpactPayload = {
  Items?: ImpactItem[];
  "@nextpageuri"?: string;
  "@total"?: string | number;
};

type ImpactCatalog = {
  Id?: string;
  CampaignName?: string;
};

type PlatformCursor = {
  cjOffset: number;
  cjNextPage: string | null;
  cjHasMore: boolean;
  impactOffset: number;
  impactHasMore: boolean;
};

type CachedSearchState = {
  rows: ResultRow[];
  selectedIds: Record<string, boolean>;
  page: number;
  cursor: PlatformCursor;
  loadedAt: number;
};

type CjValidationState = "pending" | "valid" | "invalid";
type ImpactValidationState = "pending" | "valid" | "invalid";
type ValidationQueueItem = {
  rowId: string;
  url: string;
  epoch: number;
};
type FetchFailure = { message: string; retryable: boolean };

function SidebarSection({
  title,
  badge,
  open,
  onToggle,
  children
}: {
  title: string;
  badge?: string;
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-4 border-b border-slate-200 pb-4 last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-xs font-medium uppercase tracking-wide text-slate-400">{title}</span>
          {badge ? (
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-[1px] text-[10px] text-slate-500">{badge}</span>
          ) : null}
        </span>
        <span className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}>⌄</span>
      </button>
      {open ? <div className="mt-3">{children}</div> : null}
    </div>
  );
}

/** Windowed page numbers with ellipses, e.g. 1 … 4 [5] 6 … 20. */
function buildPageList(current: number, total: number): Array<number | "gap"> {
  if (total <= 7) return Array.from({ length: total }, (_, index) => index + 1);
  const pages = new Set<number>([1, total, current]);
  if (current - 1 > 1) pages.add(current - 1);
  if (current + 1 < total) pages.add(current + 1);
  if (current <= 3) [2, 3, 4].forEach((page) => page < total && pages.add(page));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((page) => page > 1 && pages.add(page));

  const sorted = Array.from(pages).sort((a, b) => a - b);
  const result: Array<number | "gap"> = [];
  sorted.forEach((page, index) => {
    if (index > 0 && page - sorted[index - 1] > 1) result.push("gap");
    result.push(page);
  });
  return result;
}

function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calculateDiscount(originalPrice: number, currentPrice: number): number {
  if (originalPrice <= 0 || currentPrice >= originalPrice) return 0;
  return Math.round(((originalPrice - currentPrice) / originalPrice) * 100);
}

function toCurrency(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase();
}

function isBarseImpactRow(row: ResultRow): boolean {
  return row.platform === "Impact" && row.companyName.trim().toLowerCase().includes("barse");
}

async function checkUrlHealth(url: string): Promise<boolean> {
  if (!url) return false;
  const cached = impactHealthCache.get(url);
  if (cached !== undefined) return cached;
  try {
    const response = await fetch(`/api/url-health?url=${encodeURIComponent(url)}`);
    const payload = (await response.json()) as { ok?: boolean };
    const healthy = payload.ok === true;
    impactHealthCache.set(url, healthy);
    return healthy;
  } catch {
    impactHealthCache.set(url, false);
    return false;
  }
}

function shouldValidateCjUrl(row: ResultRow): boolean {
  return row.platform === "CJ" && row.companyName.trim().toUpperCase() === "NIKE";
}

function buildSelectionState(rows: ResultRow[]): Record<string, boolean> {
  const next: Record<string, boolean> = {};
  rows.forEach((row) => {
    next[row.id] = false;
  });
  try {
    const rawSelected = sessionStorage.getItem("pipeline:selected-products");
    if (!rawSelected) return next;
    const selected = JSON.parse(rawSelected) as Array<{ id?: string }>;
    selected.forEach((item) => {
      if (item?.id && next[item.id] !== undefined) {
        next[item.id] = true;
      }
    });
  } catch {
    // ignore
  }
  return next;
}

function dedupeByTitle(rows: ResultRow[]): ResultRow[] {
  const impactRows = rows.filter((row) => row.platform === "Impact");
  const cjRows = rows.filter((row) => row.platform === "CJ");

  const impactUnique = new Map<string, ResultRow>();
  for (const row of impactRows) {
    const key = `impact:${row.id}`;
    const existing = impactUnique.get(key);
    if (!existing || row.discount > existing.discount) {
      impactUnique.set(key, row);
    }
  }

  const cjByTitle = new Map<string, ResultRow>();
  for (const row of cjRows) {
    const key = `cj-title:${normalizeTitle(row.product)}`;
    const existing = cjByTitle.get(key);
    if (!existing || row.discount > existing.discount) {
      cjByTitle.set(key, row);
    }
  }

  // CJ id-level dedupe intentionally disabled for now.
  // NIKE URL validation remains active separately.
  return [...Array.from(cjByTitle.values()), ...Array.from(impactUnique.values())];
}

async function fetchImpactPage(
  keyword: string,
  offset: number,
  intent: SearchIntent
): Promise<{ rows: ResultRow[]; nextOffset: number; hasMore: boolean; total: number }> {
  const params: Record<string, string | number> = {
    limit: API_PAGE_LIMIT,
    offset,
    ...toImpactParams(intent)
  };
  // An absent keyword browses the whole catalog, which is what a pure deal search wants.
  if (keyword) params.keyword = keyword;
  console.debug("[results] impact request", { params });
  const payload = await http.get("/api/v1/impact/catalogs/item-search", { params });
  const data = unwrapEnvelope<ImpactPayload>(payload.data);
  const items = Array.isArray(data.Items) ? data.Items : [];
  const rows = items
    .map((item) => {
    const currentPrice = toNumber(item.CurrentPrice);
    const originalPrice = toNumber(item.OriginalPrice) || currentPrice;
    return {
      rowKey: `impact-${item.Id}-${item.CatalogId ?? ""}`,
      id: `impact-${item.Id}`,
      product: item.Name,
      companyName: item.CampaignName ?? "",
      campaignId: item.CampaignId,
      imageUrl: item.ImageUrl,
      imageCandidates: buildImageCandidates(item.ImageUrl, item.AdditionalImageUrls),
      productUrl: item.Url ?? "",
      platform: "Impact" as const,
      price: currentPrice,
      discount: calculateDiscount(originalPrice, currentPrice)
    };
  });
  const nextOffset = offset + API_PAGE_LIMIT;
  const hasMore = items.length > 0;
  // Impact returns -1 for some catalogs instead of a count; treat that as unknown.
  const total = Math.max(0, toNumber(data["@total"]));
  console.debug("[results] impact response", { rawCount: items.length, count: rows.length, hasMore, nextOffset, total });
  return { rows, nextOffset, hasMore, total };
}

async function fetchImpactCatalogByKeyword(
  catalogId: string,
  keyword: string,
  intent: SearchIntent,
  nextPageId?: string | null
): Promise<{ rows: ResultRow[]; hasMore: boolean; nextAfterId: string | null; total: number }> {
  const params: Record<string, string | number> = {
    limit: IMPACT_CATALOG_BY_KEYWORD_LIMIT,
    ...toImpactParams(intent)
  };
  if (keyword) params.keyword = keyword;
  if (nextPageId) {
    params.nextPageId = nextPageId;
  }
  // by-keyword requires a non-empty keyword, so a pure deal browse of one advertiser
  // has to go through the plain items endpoint, which accepts no keyword at all.
  const path = keyword
    ? `/api/v1/impact/catalogs/${catalogId}/items/by-keyword`
    : `/api/v1/impact/catalogs/${catalogId}/items`;
  const payload = await http.get(path, { params });
  const data = unwrapEnvelope<ImpactPayload>(payload.data);
  const items = Array.isArray(data.Items) ? data.Items : [];
  const rows = items.map((item) => {
    const currentPrice = toNumber(item.CurrentPrice);
    const originalPrice = toNumber(item.OriginalPrice) || currentPrice;
    return {
      rowKey: `impact-${item.Id}-${item.CatalogId ?? catalogId}`,
      id: `impact-${item.Id}`,
      product: item.Name,
      companyName: item.CampaignName ?? "",
      campaignId: item.CampaignId,
      imageUrl: item.ImageUrl,
      imageCandidates: buildImageCandidates(item.ImageUrl, item.AdditionalImageUrls),
      productUrl: item.Url ?? "",
      platform: "Impact" as const,
      price: currentPrice,
      discount: calculateDiscount(originalPrice, currentPrice)
    };
  });
  let nextAfterId: string | null = null;
  const nextUri = data["@nextpageuri"] ?? "";
  if (nextUri) {
    const query = nextUri.includes("?") ? nextUri.split("?")[1] : "";
    const search = new URLSearchParams(query);
    nextAfterId = search.get("AfterId");
  }
  const hasMore = Boolean(nextAfterId);
  return { rows, hasMore, nextAfterId, total: Math.max(0, toNumber(data["@total"])) };
}

async function fetchCjPage(
  keyword: string,
  offset: number,
  nextPageToken: string | null,
  cjAdvertiserIds: string[],
  intent: SearchIntent
): Promise<{ rows: ResultRow[]; nextOffset: number; nextPageToken: string | null; hasMore: boolean; total: number }> {
  const limit = API_PAGE_LIMIT;
  const requestBody: Record<string, unknown> = {
    company_id: "6947255",
    // CJ omits the keywords argument entirely when the list is empty, which browses all.
    keywords: keyword ? [keyword] : [],
    advertiser_countries: ["US"],
    availability: "IN_STOCK",
    partner_status: "JOINED",
    // CJ treats multiple partner_ids as OR, so several advertisers combine into one query.
    partner_ids: cjAdvertiserIds.length > 0 ? cjAdvertiserIds : [""],
    pid: "101105481",
    limit,
    // Filters only, never sort_by: CJ has no discount sort and any sort nulls nextPage,
    // which would break "Load more". Filtered rows are sorted client-side instead.
    ...toCjBody(intent)
  };
  const isFirstPage = offset === 0;
  if (!isFirstPage && !nextPageToken) {
    return { rows: [], nextOffset: offset, nextPageToken: null, hasMore: false, total: 0 };
  }
  if (nextPageToken) {
    requestBody.page = nextPageToken;
  } else {
    requestBody.offset = offset;
  }
  console.debug("[results] cj request", { keyword, offset, limit, nextPageToken, requestBody });
  const payload = await http.post("/api/v1/cj/ads/products/query", requestBody);
  const data = unwrapEnvelope<{ data?: { products?: { resultList?: CjProduct[]; totalCount?: number; nextPage?: string | null } } }>(payload.data);
  const products = data?.data?.products;
  const list = products?.resultList ?? [];
  const rows = list.map((item, index) => {
    const originalPrice = toNumber(item.price?.amount);
    const salePrice = toNumber(item.salePrice?.amount);
    const price = salePrice > 0 ? salePrice : originalPrice;
    return {
      rowKey: `cj-${item.id}-${item.catalogId ?? ""}-${index}`,
      id: `cj-${item.id}`,
      product: item.title,
      companyName: item.advertiserName ?? "",
      campaignId: undefined,
      imageUrl: item.imageLink,
      // additionalImageLink is only present if the backend GraphQL selection adds it;
      // absent today, so CJ rows carry just the primary and fall back to a placeholder.
      imageCandidates: buildImageCandidates(item.imageLink, item.additionalImageLink),
      productUrl: item.linkCode?.clickUrl || item.link,
      platform: "CJ" as const,
      price,
      discount: salePrice > 0 ? calculateDiscount(originalPrice, salePrice) : 0
    };
  });
  const total = toNumber(products?.totalCount);
  const nextOffset = offset + limit;
  const providerNextPage = products?.nextPage ?? null;
  const hasMore = Boolean(providerNextPage);
  console.debug("[results] cj response", { rawCount: list.length, count: rows.length, nextOffset, total, hasMore, providerNextPage });
  return { rows, nextOffset, nextPageToken: providerNextPage, hasMore, total };
}

export default function ResultsClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const keyword = (searchParams.get("q") ?? "").trim();
  const useCj = searchParams.get("cj") !== "0";
  const useImpact = searchParams.get("impact") !== "0";
  const cjAdvertiserIds = useMemo(
    () => readSelectionParam(searchParams, "cjAdvertiserIds", "cjAdvertiserId"),
    [searchParams]
  );
  const impactCampaigns = useMemo(
    () => readSelectionParam(searchParams, "impactCampaigns", "impactCampaign"),
    [searchParams]
  );
  const cjAdvertiserKey = cjAdvertiserIds.join(",");
  const impactCampaignKey = impactCampaigns.join(",");
  const intent = useMemo(() => readIntentFromParams(searchParams), [searchParams]);
  const [platformTotals, setPlatformTotals] = useState<{ cj: number; impact: number }>({ cj: 0, impact: 0 });
  const [openSections, setOpenSections] = useState({ platform: true, deals: true, info: true });
  const {
    cjAdvertisers: cjAdvertiserOptions,
    cjLoading: cjOptionsLoading,
    cjError: cjOptionsError,
    impactCampaigns: impactCampaignOptions,
    impactLoading: impactOptionsLoading,
    impactError: impactOptionsError
  } = usePlatformOptions({ cj: useCj, impact: useImpact });
  const [keywordDraft, setKeywordDraft] = useState("");
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [autoLoadStalls, setAutoLoadStalls] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [errorRetryable, setErrorRetryable] = useState(false);
  const [lastFailedAction, setLastFailedAction] = useState<"initial" | "loadMore" | null>(null);
  const [cursor, setCursor] = useState<PlatformCursor>({
    cjOffset: 0,
    cjNextPage: null,
    cjHasMore: useCj,
    impactOffset: 0,
    impactHasMore: useImpact
  });
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const [cjValidationState, setCjValidationState] = useState<Record<string, CjValidationState>>({});
  const [impactValidationState, setImpactValidationState] = useState<Record<string, ImpactValidationState>>({});
  const [invalidNoticeCount, setInvalidNoticeCount] = useState(0);
  const cjLastCallAtRef = useRef(0);
  const cjLinkHealthCacheRef = useRef<Map<string, boolean>>(new Map());
  const cjValidationQueueRef = useRef<ValidationQueueItem[]>([]);
  const cjValidationRunningRef = useRef(false);
  const impactValidationQueueRef = useRef<ImpactValidationQueueItem[]>([]);
  const impactValidationRunningRef = useRef(false);
  const searchEpochRef = useRef(0);
  const impactCampaignMapRef = useRef<Record<string, string[]>>({});
  const impactCatalogAfterIdRef = useRef<Record<string, string | null>>({});

  // Intent is part of the key so changing a filter never serves rows fetched under the old one.
  const cacheKey = useMemo(
    () =>
      `results-cache:v3:${keyword}:${useCj ? "1" : "0"}:${useImpact ? "1" : "0"}:${cjAdvertiserKey || "all"}:${impactCampaignKey || "all"}` +
      `:${intent.sort}:${intent.minDiscount}:${intent.minPrice ?? ""}:${intent.maxPrice ?? ""}`,
    [keyword, useCj, useImpact, cjAdvertiserKey, impactCampaignKey, intent]
  );

  useEffect(() => {
    try {
      const rawMap = sessionStorage.getItem("search:impact-campaign-map");
      if (rawMap) {
        impactCampaignMapRef.current = JSON.parse(rawMap) as Record<string, string[]>;
      }
    } catch {
      impactCampaignMapRef.current = {};
    }
  }, []);

  useEffect(() => {
    const params = searchParams.toString();
    const href = params ? `/results?${params}` : "/results";
    sessionStorage.setItem("pipeline:last-results-url", href);
  }, [searchParams]);

  useEffect(() => {
    setKeywordDraft(keyword);
  }, [keyword]);

  const fetchImpactCampaignCatalogMap = async (): Promise<Record<string, string[]>> => {
    if (Object.keys(impactCampaignMapRef.current).length > 0) {
      return impactCampaignMapRef.current;
    }
    const limit = 20;
    let offset = 0;
    const map = new Map<string, Set<string>>();
    while (true) {
      const response = await http.get("/api/v1/impact/catalogs", {
        params: { limit, offset }
      });
      const data = unwrapEnvelope<{ Catalogs?: ImpactCatalog[] }>(response.data);
      const catalogs = Array.isArray(data.Catalogs) ? data.Catalogs : [];
      catalogs.forEach((catalog) => {
        const campaignName = String(catalog.CampaignName ?? "").trim();
        const catalogId = String(catalog.Id ?? "").trim();
        if (!campaignName || !catalogId) return;
        if (!map.has(campaignName)) {
          map.set(campaignName, new Set());
        }
        map.get(campaignName)?.add(catalogId);
      });
      if (catalogs.length < limit) break;
      offset += limit;
    }
    const objectMap = Array.from(map.entries()).reduce<Record<string, string[]>>((acc, [name, ids]) => {
      acc[name] = Array.from(ids);
      return acc;
    }, {});
    impactCampaignMapRef.current = objectMap;
    try {
      sessionStorage.setItem("search:impact-campaign-map", JSON.stringify(objectMap));
    } catch {
      // ignore cache write errors
    }
    return objectMap;
  };

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(CJ_URL_HEALTH_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      cjLinkHealthCacheRef.current = new Map(Object.entries(parsed));
    } catch {
      cjLinkHealthCacheRef.current = new Map();
    }
  }, []);

  const persistCjHealthCache = () => {
    try {
      sessionStorage.setItem(
        CJ_URL_HEALTH_CACHE_KEY,
        JSON.stringify(Object.fromEntries(cjLinkHealthCacheRef.current.entries()))
      );
    } catch {
      // ignore cache persistence failures
    }
  };

  const removeInvalidRows = (invalidIds: string[]) => {
    if (invalidIds.length === 0) return;
    const invalidSet = new Set(invalidIds);
    let removedSelected = 0;
    setRows((prev) => prev.filter((row) => !invalidSet.has(row.id)));
    setSelectedIds((prev) => {
      const next = { ...prev };
      invalidIds.forEach((id) => {
        if (next[id]) removedSelected += 1;
        delete next[id];
      });
      return next;
    });
    if (removedSelected > 0) {
      setInvalidNoticeCount((prev) => prev + removedSelected);
    }
  };

  const processImpactValidationQueue = async () => {
    if (impactValidationRunningRef.current) return;
    impactValidationRunningRef.current = true;
    try {
      while (impactValidationQueueRef.current.length > 0) {
        const currentEpoch = searchEpochRef.current;
        const batch = impactValidationQueueRef.current
          .splice(0, IMPACT_BARSE_VALIDATION_BATCH_SIZE)
          .filter((item) => item.epoch === currentEpoch);
        if (batch.length === 0) continue;
        const checks = await Promise.all(
          batch.map(async (item) => {
            const imageOk = await checkUrlHealth(item.imageUrl);
            return { rowId: item.rowId, healthy: imageOk };
          })
        );
        setImpactValidationState((prev) => {
          const next = { ...prev };
          checks.forEach((item) => {
            next[item.rowId] = item.healthy ? "valid" : "invalid";
          });
          return next;
        });
        const invalidIds = checks.filter((item) => !item.healthy).map((item) => item.rowId);
        removeInvalidRows(invalidIds);
      }
    } finally {
      impactValidationRunningRef.current = false;
    }
  };

  const queueImpactBarseValidation = (candidateRows: ResultRow[]) => {
    const currentEpoch = searchEpochRef.current;
    const queuedIds = new Set(impactValidationQueueRef.current.map((item) => item.rowId));
    const toQueue: ImpactValidationQueueItem[] = [];
    const pendingIds: string[] = [];
    const invalidIds: string[] = [];
    candidateRows
      .filter((row) => {
        if (!isBarseImpactRow(row)) return false;
        if (!row.imageUrl || !row.productUrl) return true;
        return true;
      })
      .forEach((row) => {
        if (!row.imageUrl || !row.productUrl) {
          invalidIds.push(row.id);
          return;
        }
        const imageCached = impactHealthCache.get(row.imageUrl);
        if (imageCached !== undefined) {
          if (imageCached) {
            // fully validated, no queue needed
            setImpactValidationState((prev) => ({ ...prev, [row.id]: "valid" }));
          } else {
            invalidIds.push(row.id);
          }
          return;
        }
        if (queuedIds.has(row.id)) return;
        pendingIds.push(row.id);
        toQueue.push({
          rowId: row.id,
          imageUrl: row.imageUrl,
          epoch: currentEpoch
        });
      });
    if (pendingIds.length > 0 || invalidIds.length > 0) {
      const pendingSet = new Set(pendingIds);
      const invalidSet = new Set(invalidIds);
      setImpactValidationState((prev) => {
        const next = { ...prev };
        pendingSet.forEach((id) => {
          next[id] = "pending";
        });
        invalidSet.forEach((id) => {
          next[id] = "invalid";
        });
        return next;
      });
    }
    if (invalidIds.length > 0) {
      removeInvalidRows(invalidIds);
    }
    if (toQueue.length > 0) {
      impactValidationQueueRef.current.push(...toQueue);
      void processImpactValidationQueue();
    }
  };

  const processCjValidationQueue = async () => {
    if (cjValidationRunningRef.current) return;
    cjValidationRunningRef.current = true;
    try {
      while (cjValidationQueueRef.current.length > 0) {
        const currentEpoch = searchEpochRef.current;
        const batch = cjValidationQueueRef.current
          .splice(0, CJ_VALIDATION_BATCH_SIZE)
          .filter((item) => item.epoch === currentEpoch);
        if (batch.length === 0) continue;

        const checks = await Promise.all(
          batch.map(async (item) => {
            const cached = cjLinkHealthCacheRef.current.get(item.url);
            if (cached !== undefined) {
              return { rowId: item.rowId, healthy: cached };
            }
            try {
              const response = await fetch(`/api/url-health?url=${encodeURIComponent(item.url)}`);
              const payload = (await response.json()) as { ok?: boolean };
              const healthy = payload.ok === true;
              cjLinkHealthCacheRef.current.set(item.url, healthy);
              return { rowId: item.rowId, healthy };
            } catch {
              cjLinkHealthCacheRef.current.set(item.url, false);
              return { rowId: item.rowId, healthy: false };
            }
          })
        );

        persistCjHealthCache();

        const invalidIds = checks.filter((item) => !item.healthy).map((item) => item.rowId);
        setCjValidationState((prev) => {
          const next = { ...prev };
          checks.forEach((item) => {
            next[item.rowId] = item.healthy ? "valid" : "invalid";
          });
          return next;
        });
        removeInvalidRows(invalidIds);
      }
    } finally {
      cjValidationRunningRef.current = false;
    }
  };

  const queueCjValidation = (candidateRows: ResultRow[]) => {
    if (!ENABLE_CJ_LINK_VALIDATION) return;
    const currentEpoch = searchEpochRef.current;
    const queuedIds = new Set(cjValidationQueueRef.current.map((item) => item.rowId));
    const toQueue: ValidationQueueItem[] = [];
    const validIds: string[] = [];
    const pendingIds: string[] = [];
    const invalidIds: string[] = [];

    candidateRows
      .filter((row) => row.platform === "CJ" && Boolean(row.productUrl))
      .forEach((row) => {
        if (!shouldValidateCjUrl(row)) {
          validIds.push(row.id);
          return;
        }
        const cached = cjLinkHealthCacheRef.current.get(row.productUrl);
        if (cached === true) {
          validIds.push(row.id);
          return;
        }
        if (cached === false) {
          invalidIds.push(row.id);
          return;
        }
        if (queuedIds.has(row.id)) return;
        pendingIds.push(row.id);
        toQueue.push({ rowId: row.id, url: row.productUrl, epoch: currentEpoch });
      });

    if (validIds.length > 0 || pendingIds.length > 0) {
      const validSet = new Set(validIds);
      const pendingSet = new Set(pendingIds);
      setCjValidationState((prev) => {
        const next = { ...prev };
        validSet.forEach((id) => {
          next[id] = "valid";
        });
        pendingSet.forEach((id) => {
          next[id] = "pending";
        });
        return next;
      });
    }

    if (invalidIds.length > 0) {
      setCjValidationState((prev) => {
        const next = { ...prev };
        invalidIds.forEach((id) => {
          next[id] = "invalid";
        });
        return next;
      });
      removeInvalidRows(invalidIds);
    }

    if (toQueue.length > 0) {
      cjValidationQueueRef.current.push(...toQueue);
      void processCjValidationQueue();
    }
  };

  const throttleCj = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, 2500 - (now - cjLastCallAtRef.current));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    cjLastCallAtRef.current = Date.now();
  };

  const fetchChunk = async (state: PlatformCursor) => {
    const tasks: Promise<{
      platform: "CJ" | "Impact";
      result: { rows: ResultRow[]; nextOffset: number; nextPageToken?: string | null; hasMore: boolean; total?: number };
      warnings?: FetchFailure[];
    }>[] = [];
    if (useCj && state.cjHasMore) {
      if (state.cjOffset > 0 && !state.cjNextPage) {
        state.cjHasMore = false;
      } else {
      tasks.push((async () => {
        await throttleCj();
        const result = await fetchCjPage(keyword, state.cjOffset, state.cjNextPage, cjAdvertiserIds, intent);
        return { platform: "CJ" as const, result: { rows: result.rows, nextOffset: result.nextOffset, nextPageToken: result.nextPageToken, hasMore: result.hasMore, total: result.total } };
      })());
      }
    }
    if (useImpact && state.impactHasMore) {
      tasks.push((async () => {
        if (impactCampaigns.length === 0) {
          const result = await fetchImpactPage(keyword, state.impactOffset, intent);
          return { platform: "Impact" as const, result: { rows: result.rows, nextOffset: result.nextOffset, hasMore: result.hasMore, total: result.total } };
        }

        const campaignMap = await fetchImpactCampaignCatalogMap();
        // Several campaigns can share a catalog, so union the ids rather than concatenating.
        const catalogIds = Array.from(
          new Set(impactCampaigns.flatMap((campaign) => campaignMap[campaign] ?? []))
        );
        if (catalogIds.length === 0) {
          return { platform: "Impact" as const, result: { rows: [], nextOffset: state.impactOffset, hasMore: false, total: 0 } };
        }

        const settledCatalogs = await Promise.allSettled(
          catalogIds.map((catalogId) =>
            fetchImpactCatalogByKeyword(
              catalogId,
              keyword,
              intent,
              impactCatalogAfterIdRef.current[catalogId] ?? null
            )
          )
        );
        const combinedRows: ResultRow[] = [];
        let anyHasMore = false;
        let combinedTotal = 0;
        const warnings: FetchFailure[] = [];
        settledCatalogs.forEach((catalogResult, index) => {
          const catalogId = catalogIds[index];
          if (catalogResult.status === "fulfilled") {
            combinedRows.push(...catalogResult.value.rows);
            combinedTotal += catalogResult.value.total;
            impactCatalogAfterIdRef.current[catalogId] = catalogResult.value.nextAfterId;
            if (catalogResult.value.hasMore) anyHasMore = true;
          } else {
            const meta = getErrorMeta(catalogResult.reason);
            warnings.push({ message: meta.message || "Impact catalog fetch failed", retryable: meta.retryable });
          }
        });
        return {
          platform: "Impact" as const,
          result: { rows: combinedRows, nextOffset: state.impactOffset + API_PAGE_LIMIT, hasMore: anyHasMore, total: combinedTotal },
          warnings
        };
      })());
    }

    const settled = await Promise.allSettled(tasks);
    const nextState: PlatformCursor = { ...state };
    const chunkRows: ResultRow[] = [];
    const failures: FetchFailure[] = [];
    const totals: { cj?: number; impact?: number } = {};

    settled.forEach((item) => {
      if (item.status === "rejected") {
        const meta = getErrorMeta(item.reason);
        failures.push({ message: meta.message, retryable: meta.retryable });
        return;
      }
      const { platform, result } = item.value;
      chunkRows.push(...result.rows);
      if (item.value.warnings?.length) {
        failures.push(...item.value.warnings);
      }
      if (platform === "CJ") {
        nextState.cjOffset = result.nextOffset;
        nextState.cjNextPage = result.nextPageToken ?? null;
        nextState.cjHasMore = result.hasMore;
        totals.cj = result.total;
      } else {
        nextState.impactOffset = result.nextOffset;
        nextState.impactHasMore = result.hasMore;
        totals.impact = result.total;
      }
    });

    return { chunkRows, nextState, failures, totals };
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      setErrorRetryable(false);
      setLastFailedAction(null);
      setPage(1);
      try {
        const shouldRestore = sessionStorage.getItem("pipeline:allow-results-restore") === "1";
        sessionStorage.removeItem("pipeline:allow-results-restore");
        searchEpochRef.current += 1;
        cjValidationQueueRef.current = [];
        impactValidationQueueRef.current = [];
        impactCatalogAfterIdRef.current = {};
        setCjValidationState({});
        setImpactValidationState({});
        setInvalidNoticeCount(0);

        if (ENABLE_RESULTS_CACHE) {
          const rawCache = sessionStorage.getItem(cacheKey);
          if (rawCache && shouldRestore) {
            const cached = JSON.parse(rawCache) as CachedSearchState;
            if (Date.now() - cached.loadedAt < CACHE_TTL_MS) {
              setRows(cached.rows);
              setCursor(cached.cursor);
              setSelectedIds(cached.selectedIds ?? buildSelectionState(cached.rows));
              setPage(cached.page ?? 1);
              queueCjValidation(cached.rows);
              queueImpactBarseValidation(cached.rows);
              return;
            }
          }
        }

        const initialState: PlatformCursor = {
          cjOffset: 0,
          cjNextPage: null,
          cjHasMore: useCj,
          impactOffset: 0,
          impactHasMore: useImpact
        };
        const { chunkRows, nextState, failures, totals } = await fetchChunk(initialState);
        const deduped = dedupeByTitle(chunkRows);
        setRows(deduped);
        setCursor(nextState);
        setPlatformTotals({ cj: totals.cj ?? 0, impact: totals.impact ?? 0 });
        const initialSelection = shouldRestore ? buildSelectionState(deduped) : Object.fromEntries(deduped.map((row) => [row.id, false]));
        setSelectedIds(initialSelection);
        queueCjValidation(deduped);
        queueImpactBarseValidation(deduped);
        if (failures.length) {
          setError(failures.map((item) => item.message).join(" | "));
          setErrorRetryable(failures.some((item) => item.retryable));
          setLastFailedAction("initial");
        }
        console.debug("[results] initial load completed", {
          keyword,
          useCj,
          useImpact,
          loadedRows: deduped.length,
          failures
        });
      } catch (requestError) {
        const meta = getErrorMeta(requestError);
        setError(meta.message || "Failed to fetch results");
        setErrorRetryable(meta.retryable);
        setLastFailedAction("initial");
        setRows([]);
        console.error("[results] initial load failed", requestError);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [cacheKey, keyword, useCj, useImpact, cjAdvertiserKey, impactCampaignKey]);

  useEffect(() => {
    if (!keyword || !ENABLE_RESULTS_CACHE) return;
    const cachePayload: CachedSearchState = { rows, selectedIds, page, cursor, loadedAt: Date.now() };
    sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
  }, [cacheKey, cursor, keyword, page, rows, selectedIds]);

  /** Returns how many rows survived dedupe, so auto-loading can detect a stall. */
  const loadMore = async (): Promise<number> => {
    setLoadingMore(true);
    setError(null);
    setErrorRetryable(false);
    setLastFailedAction(null);
    try {
      const { chunkRows, nextState, failures } = await fetchChunk(cursor);
      const merged = dedupeByTitle([...rows, ...chunkRows]);
      setRows(merged);
      setCursor(nextState);
      queueCjValidation(merged);
      queueImpactBarseValidation(merged);
      setSelectedIds((prev) => {
        const next = { ...prev };
        merged.forEach((row) => {
          if (next[row.id] === undefined) next[row.id] = false;
        });
        return next;
      });
      if (failures.length) {
        setError(failures.map((item) => item.message).join(" | "));
        setErrorRetryable(failures.some((item) => item.retryable));
        setLastFailedAction("loadMore");
      }
      console.debug("[results] load more completed", {
        addedRows: chunkRows.length,
        totalRows: merged.length,
        failures
      });
      return merged.length - rows.length;
    } catch (requestError) {
      const meta = getErrorMeta(requestError);
      setError(meta.message || "Failed to load more");
      setErrorRetryable(meta.retryable);
      setLastFailedAction("loadMore");
      console.error("[results] load more failed", requestError);
      return 0;
    } finally {
      setLoadingMore(false);
    }
  };

  const retryLastFailed = async () => {
    if (!errorRetryable || !lastFailedAction) return;
    if (lastFailedAction === "initial") {
      router.refresh();
      return;
    }
    await loadMore();
  };

  const selectedCount = useMemo(
    () => rows.filter((row) => Boolean(selectedIds[row.id])).length,
    [rows, selectedIds]
  );
  const filteredRows = useMemo(() => {
    const validated = rows.filter((row) => {
      if (!ENABLE_CJ_LINK_VALIDATION) return true;
      if (row.platform === "CJ") {
        if (!shouldValidateCjUrl(row)) return true;
        return cjValidationState[row.id] === "valid";
      }
      if (isBarseImpactRow(row)) {
        return impactValidationState[row.id] === "valid";
      }
      return true;
    });
    // Drops feed errors (100% off at $0.01) and orders the merged CJ+Impact list.
    return applyIntent(validated, intent);
  }, [cjValidationState, impactValidationState, rows, intent]);
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page]
  );
  const hasNextUiPage = filteredRows.length > page * PAGE_SIZE;
  // The current page always counts, even before its rows have arrived — landing on a
  // fresh page renders it empty for a moment while auto-load fills it.
  const totalUiPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE), page);
  const pageList = useMemo(() => buildPageList(page, totalUiPages), [page, totalUiPages]);
  const hasMoreFromApis = cursor.cjHasMore || cursor.impactHasMore;
  const pageIsFull = filteredRows.length >= page * PAGE_SIZE;
  const autoLoadStalled = autoLoadStalls >= AUTO_LOAD_STALL_LIMIT;
  // Only auto-load while the visible page is short. Once it holds PAGE_SIZE rows the
  // pager unlocks, and landing on the next page starts this over for that page.
  const shouldAutoLoad = !loading && !error && !pageIsFull && hasMoreFromApis && !autoLoadStalled;
  // A page holding exactly PAGE_SIZE rows stops auto-loading, so "next" has to fall back
  // to whether the platforms still have more — otherwise the user strands at exactly 50.
  // ...but not once auto-loading has stalled: the platforms still claim more while
  // returning nothing usable, and advancing there lands on a permanently empty page.
  const canGoNext = hasNextUiPage || (hasMoreFromApis && !autoLoadStalled);

  // Tightening a filter can shrink the list past the current page. Only pull the user
  // back once nothing more is coming, or this would fight the auto-loader.
  useEffect(() => {
    if (hasMoreFromApis || loadingMore) return;
    const maxPage = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
    setPage((prev) => (prev > maxPage ? maxPage : prev));
  }, [filteredRows.length, hasMoreFromApis, loadingMore]);

  // Each page gets a fresh stall budget, so a stall while filling page 1 doesn't stop
  // page 2 from filling.
  useEffect(() => {
    setAutoLoadStalls(0);
  }, [page, cacheKey]);

  useEffect(() => {
    if (!shouldAutoLoad || loadingMore) return;
    const timer = setTimeout(() => {
      void loadMore().then((added) => {
        setAutoLoadStalls((prev) => (added > 0 ? 0 : prev + 1));
      });
    }, AUTO_LOAD_DELAY_MS);
    return () => clearTimeout(timer);
    // loadMore is recreated every render; shouldAutoLoad already captures everything that
    // decides whether another round is warranted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAutoLoad, loadingMore, rows.length]);
  const pendingCjValidations = useMemo(
    () => Object.values(cjValidationState).filter((value) => value === "pending").length,
    [cjValidationState]
  );
  const selectedRows = useMemo(
    () => filteredRows.filter((row) => Boolean(selectedIds[row.id])),
    [filteredRows, selectedIds]
  );

  /** Filters live in the URL, so changing one re-queries the platforms, not the loaded page. */
  const applyIntentToUrl = (nextIntent: SearchIntent, nextKeyword?: string) => {
    const params = new URLSearchParams(searchParams.toString());
    writeIntentToParams(params, { ...nextIntent, keyword: nextKeyword ?? keyword });
    router.push(`/results?${params.toString()}`);
  };

  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  /** Platform and advertiser changes re-query, so they go through the URL like the filters. */
  const updateSelection = (changes: {
    cj?: boolean;
    impact?: boolean;
    cjIds?: string[];
    campaigns?: string[];
  }) => {
    const params = new URLSearchParams(searchParams.toString());
    const nextCj = changes.cj ?? useCj;
    const nextImpact = changes.impact ?? useImpact;
    // Never leave both off: that would search nothing at all.
    if (!nextCj && !nextImpact) return;

    params.set("cj", nextCj ? "1" : "0");
    params.set("impact", nextImpact ? "1" : "0");
    writeSelectionParam(params, "cjAdvertiserIds", "cjAdvertiserId", nextCj ? (changes.cjIds ?? cjAdvertiserIds) : []);
    writeSelectionParam(params, "impactCampaigns", "impactCampaign", nextImpact ? (changes.campaigns ?? impactCampaigns) : []);
    router.push(`/results?${params.toString()}`);
  };

  const applyKeywordEdit = () => {
    const next = keywordDraft.trim();
    if (next === keyword) return;
    applyIntentToUrl(intent, next);
  };

  const intentChips = useMemo(() => describeIntent(intent), [intent]);
  const totalAvailable = platformTotals.cj + platformTotals.impact;

  const handleBuildPostPackage = () => {
    if (selectedRows.length === 0) {
      setError("Select at least one product to continue to Review.");
      return;
    }
    const payload = selectedRows.map((row) => ({
      id: row.id,
      product: row.product,
      companyName: row.companyName,
      campaignId: row.campaignId,
      imageUrl: row.imageUrl,
      // Carried so the pipeline can fall back through alternates if the primary image is dead.
      imageCandidates: row.imageCandidates,
      productUrl: row.productUrl,
      platform: row.platform,
      price: row.price,
      discount: row.discount
    }));
    sessionStorage.setItem("pipeline:selected-products", JSON.stringify(payload));
    sessionStorage.setItem("pipeline:allow-results-restore", "1");
    router.push("/review");
  };

  return (
    <>
      <TopNav />
      <FlowStepper active={2} />
      <div className="grid min-h-[calc(100vh-58px)] grid-cols-1 md:grid-cols-[288px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <SidebarSection
            title="Platform"
            badge={useCj && useImpact ? "Both" : useCj ? "CJ" : "Impact"}
            open={openSections.platform}
            onToggle={() => toggleSection("platform")}
          >
            <div className="mb-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => updateSelection({ cj: !useCj })}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  useCj ? "border-[#185FA5] bg-[#E6F1FB] text-[#0C447C]" : "border-slate-300 bg-white text-slate-500"
                }`}
              >
                {useCj ? "✓ " : ""}CJ
              </button>
              <button
                type="button"
                onClick={() => updateSelection({ impact: !useImpact })}
                className={`rounded-full border px-3 py-1 text-xs transition ${
                  useImpact ? "border-[#3C3489] bg-[#EEEDFE] text-[#3C3489]" : "border-slate-300 bg-white text-slate-500"
                }`}
              >
                {useImpact ? "✓ " : ""}Impact
              </button>
            </div>

            {useCj ? (
              <div className="mb-3">
                <MultiSelectChips
                  label="CJ Advertisers"
                  options={cjAdvertiserOptions}
                  selected={cjAdvertiserIds}
                  onChange={(next) => updateSelection({ cjIds: next })}
                  loading={cjOptionsLoading}
                  error={cjOptionsError}
                  emptyLabel="All advertisers"
                  compact
                />
              </div>
            ) : null}
            {useImpact ? (
              <MultiSelectChips
                label="Impact Advertisers"
                options={impactCampaignOptions}
                selected={impactCampaigns}
                onChange={(next) => updateSelection({ campaigns: next })}
                loading={impactOptionsLoading}
                error={impactOptionsError}
                emptyLabel="All advertisers"
                compact
              />
            ) : null}
          </SidebarSection>

          <SidebarSection
            title="Search"
            open={openSections.deals}
            onToggle={() => toggleSection("deals")}
            badge={intent.dealsEnabled ? "Filtered" : undefined}
          >
            <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
              Keyword
            </label>
            <div className="mb-4 flex items-center gap-1.5">
              <input
                className="field min-w-0 flex-1 px-2 py-1 text-xs"
                placeholder="All products"
                value={keywordDraft}
                onChange={(event) => setKeywordDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") applyKeywordEdit();
                }}
              />
              <button
                type="button"
                onClick={applyKeywordEdit}
                disabled={keywordDraft.trim() === keyword}
                className="btn-primary shrink-0 px-2 py-1 text-xs disabled:opacity-40"
              >
                Go
              </button>
            </div>
            <DealsPanel intent={intent} onChange={applyIntentToUrl} compact />
          </SidebarSection>

          <SidebarSection
            title="Result info"
            open={openSections.info}
            onToggle={() => toggleSection("info")}
            badge={`Page ${page}`}
          >
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
              <p>Page: <span className="font-medium text-slate-800">{page} of {totalUiPages}</span></p>
              <p className="mt-1">Loaded: <span className="font-medium text-slate-800">{rows.length}</span></p>
              {totalAvailable > 0 ? (
                <p className="mt-1">Matching: <span className="font-medium text-slate-800">{totalAvailable.toLocaleString()}</span></p>
              ) : null}
            </div>
          </SidebarSection>
        </aside>

        <main className="p-4 pb-24 md:p-6 md:pb-24">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            {/* Label only. An empty keyword still sends NO keyword upstream — sending the
                literal "all products" makes Impact text-match it and return junk. */}
            <input className="field w-full max-w-md" value={`Results for "${keyword || "all products"}"`} readOnly />
          </div>
          {intentChips.length > 0 ? (
            <div className="mb-3 flex flex-wrap items-center gap-2">
              {intentChips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  onClick={() => applyIntentToUrl(clearIntentKey(intent, chip.key))}
                  className="flex items-center gap-1 rounded-full border border-[#185FA5] bg-[#E6F1FB] px-3 py-1 text-xs text-[#0C447C]"
                  title="Remove this filter"
                >
                  {chip.label}
                  <span className="text-[#0C447C]/60">✕</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => applyIntentToUrl({ ...intent, dealsEnabled: false, sort: "relevance", minDiscount: 0, minPrice: null, maxPrice: null })}
                className="text-xs text-slate-500 underline"
              >
                Clear all
              </button>
            </div>
          ) : null}
          <p className="mb-2 text-xs text-slate-500">
            {loading ? "Loading results..." : `Showing ${visibleRows.length} of ${filteredRows.length} results · ${selectedCount} selected`}
          </p>
          {!loading && ENABLE_CJ_LINK_VALIDATION && pendingCjValidations > 0 ? (
            <p className="mb-2 text-xs text-slate-500">Validating links... {pendingCjValidations} pending</p>
          ) : null}
          {!loading && invalidNoticeCount > 0 ? (
            <p className="mb-2 text-xs text-amber-700">{invalidNoticeCount} invalid selected product(s) removed.</p>
          ) : null}
          {error ? (
            <div className="mb-2 flex items-center gap-2">
              <p className="text-sm text-red-600">{error}</p>
              {errorRetryable ? (
                <button type="button" className="btn-secondary" onClick={() => void retryLastFailed()}>
                  Retry
                </button>
              ) : null}
            </div>
          ) : null}

          {loading ? (
            <div className="grid min-h-[340px] place-items-center rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-col items-center gap-3">
                <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-300 border-t-[#185FA5]" />
                <p className="text-sm font-medium text-slate-600">Loading Products</p>
              </div>
            </div>
          ) : (
          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[860px] border-collapse table-fixed">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="w-[42px] p-2 pl-3 text-left">
                    <input
                      type="checkbox"
                      checked={visibleRows.length > 0 && visibleRows.every((row) => Boolean(selectedIds[row.id]))}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setSelectedIds((prev) => {
                          const next = { ...prev };
                          visibleRows.forEach((row) => {
                            next[row.id] = checked;
                          });
                          return next;
                        });
                      }}
                    />
                  </th>
                  <th className="w-[72px] p-2 text-left">Image</th>
                  <th className="w-[34%]">Product</th>
                  <th className="w-[120px]">Platform</th>
                  <th className="w-[110px]">Price</th>
                  <th className="w-[110px]">Discount</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowKey}>
                    <td className="border-t border-slate-200 p-2 pl-3 text-left">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedIds[row.id])}
                        onChange={(event) =>
                          setSelectedIds((prev) => ({ ...prev, [row.id]: event.target.checked }))
                        }
                      />
                    </td>
                    <td className="border-t border-slate-200 p-2 text-left text-sm">
                      {row.imageUrl ? (
                        <button
                          type="button"
                          onClick={() => setPreview({ url: row.imageUrl, title: row.product })}
                          className="rounded"
                        >
                          <img
                            src={row.imageUrl}
                            alt={row.product}
                            className="h-12 w-12 rounded object-cover border border-slate-200"
                            onError={(event) => {
                              event.currentTarget.style.display = "none";
                            }}
                          />
                        </button>
                      ) : (
                        <div className="h-12 w-12 rounded border border-slate-200 bg-slate-50" />
                      )}
                    </td>
                    <td className="border-t border-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <div>
                          <p className="text-sm font-medium">{row.product}</p>
                          {row.companyName ? <p className="text-xs text-slate-500">{row.companyName}</p> : null}
                        </div>
                        {row.productUrl ? (
                          <a
                            href={row.productUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="text-slate-500 hover:text-slate-700"
                            title="Open product page"
                          >
                            ↗
                          </a>
                        ) : null}
                      </div>
                    </td>
                    <td className="border-t border-slate-200 text-sm">
                      <div className="flex items-center gap-2">
                        <span className={`badge ${row.platform === "CJ" ? "badge-cj" : "badge-imp"}`}>{row.platform}</span>
                        {row.platform === "CJ" && cjValidationState[row.id] === "pending" ? (
                          <span className="text-[11px] text-slate-400">validating...</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="border-t border-slate-200 text-sm">{toCurrency(row.price)}</td>
                    <td className="border-t border-slate-200 text-sm">
                      <span className="rounded-full bg-emerald-50 px-2 py-[2px] text-xs text-emerald-700">{row.discount}%</span>
                    </td>
                  </tr>
                ))}
                {!loading && visibleRows.length === 0 ? (
                  <tr>
                    <td className="border-t border-slate-200 p-6 text-sm text-slate-500" colSpan={6}>
                      {intent.dealsEnabled ? (
                        <div className="flex flex-col items-start gap-3">
                          <div>
                            <p className="font-medium text-slate-700">No products match these filters.</p>
                            <p className="mt-1 text-xs">
                              A specific advertiser combined with a high discount often has nothing in stock.
                              Try loosening one filter:
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {intent.minDiscount > 1 ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() =>
                                  applyIntentToUrl({
                                    ...intent,
                                    minDiscount: intent.minDiscount > 50 ? 50 : intent.minDiscount > 25 ? 25 : 1
                                  })
                                }
                              >
                                Lower to {intent.minDiscount > 50 ? "50%" : intent.minDiscount > 25 ? "25%" : "any sale"}
                              </button>
                            ) : null}
                            {intent.minPrice !== null || intent.maxPrice !== null ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => applyIntentToUrl({ ...intent, minPrice: null, maxPrice: null })}
                              >
                                Clear price range
                              </button>
                            ) : null}
                            {cjAdvertiserIds.length > 0 || impactCampaigns.length > 0 ? (
                              <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => updateSelection({ cjIds: [], campaigns: [] })}
                              >
                                Search all advertisers
                              </button>
                            ) : null}
                          </div>
                        </div>
                      ) : (
                        "No results found."
                      )}
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          )}
          {!loading && filteredRows.length > 0 ? (
            <div className="mt-3 flex flex-wrap items-center justify-center gap-1 text-sm">
              <button
                type="button"
                onClick={() => setPage(1)}
                disabled={page === 1}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
                aria-label="First page"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
              >
                Prev
              </button>

              {pageList.map((entry, index) =>
                entry === "gap" ? (
                  <span key={`gap-${index}`} className="px-1 text-xs text-slate-400">
                    …
                  </span>
                ) : (
                  <button
                    key={entry}
                    type="button"
                    onClick={() => setPage(entry)}
                    aria-current={entry === page ? "page" : undefined}
                    className={`min-w-[30px] rounded-md border px-2 py-1 text-xs transition ${
                      entry === page
                        ? "border-[#185FA5] bg-[#185FA5] font-medium text-white"
                        : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {entry}
                  </button>
                )
              )}

              <button
                type="button"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!canGoNext}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
              >
                Next
              </button>
              <button
                type="button"
                onClick={() => setPage(totalUiPages)}
                disabled={page === totalUiPages && !hasMoreFromApis}
                className="btn-secondary px-2 py-1 text-xs disabled:opacity-40"
                aria-label="Last page"
              >
                »
              </button>
            </div>
          ) : null}
          {!loading && (loadingMore || shouldAutoLoad) ? (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#185FA5]" />
              <span>
                Loading more results... {Math.max(0, Math.min(filteredRows.length, page * PAGE_SIZE) - (page - 1) * PAGE_SIZE)} of {PAGE_SIZE} on this page
              </span>
            </div>
          ) : null}

          {/* Auto-loading gave up because fetches stopped yielding usable rows. Say so
              rather than spinning forever with nothing to show for it. */}
          {!loading && !loadingMore && autoLoadStalled && !pageIsFull ? (
            <p className="mt-4 text-center text-xs text-slate-400">
              Only {filteredRows.length} products match these filters. Loosen the discount or
              price range to see more.
            </p>
          ) : null}

          {!loading && !loadingMore && !hasMoreFromApis && filteredRows.length > 0 ? (
            <p className="mt-4 text-center text-xs text-slate-400">End of results.</p>
          ) : null}

          <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur">
            <div className="flex w-full items-center justify-end px-4 py-3 md:px-6">
              <div className="flex gap-2">
              <button type="button" onClick={handleBuildPostPackage} className="btn-primary">Review selection</button>
              </div>
            </div>
          </div>
          {preview ? (
            <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/50 p-4">
              <div className="w-full max-w-[560px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="truncate text-sm font-medium">{preview.title}</p>
                  <button type="button" onClick={() => setPreview(null)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500">Close</button>
                </div>
                <div className="grid h-[420px] place-items-center overflow-hidden rounded-lg bg-slate-50 p-3">
                  <img src={preview.url} alt={preview.title} className="h-full w-full rounded object-contain" />
                </div>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </>
  );
}
