"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getErrorMeta } from "@/lib/api/errors";

const PAGE_SIZE = 50;
const API_PAGE_LIMIT = 100;
const IMPACT_CATALOG_BY_KEYWORD_LIMIT = 50;
const CACHE_TTL_MS = 5 * 60 * 1000;
const ENABLE_RESULTS_CACHE = true;
const ENABLE_CJ_LINK_VALIDATION = true;
const CJ_VALIDATION_BATCH_SIZE = 8;
const CJ_URL_HEALTH_CACHE_KEY = "results:cj-url-health:v1";

type ResultRow = {
  rowKey: string;
  id: string;
  product: string;
  companyName: string;
  campaignId?: string;
  imageUrl: string;
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
  IsParent?: boolean;
  CurrentPrice?: string | number | null;
  OriginalPrice?: string | number | null;
};

type ImpactPayload = {
  Items?: ImpactItem[];
  "@nextpageuri"?: string;
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
type ValidationQueueItem = {
  rowId: string;
  url: string;
  epoch: number;
};
type FetchFailure = { message: string; retryable: boolean };

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

async function fetchImpactPage(keyword: string, offset: number): Promise<{ rows: ResultRow[]; nextOffset: number; hasMore: boolean }> {
  const params: Record<string, string | number> = {
    keyword,
    limit: API_PAGE_LIMIT,
    offset
  };
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
      productUrl: item.Url ?? "",
      platform: "Impact" as const,
      price: currentPrice,
      discount: calculateDiscount(originalPrice, currentPrice)
    };
  });
  const nextOffset = offset + API_PAGE_LIMIT;
  const hasMore = items.length > 0;
  console.debug("[results] impact response", { rawCount: items.length, count: rows.length, hasMore, nextOffset });
  return { rows, nextOffset, hasMore };
}

async function fetchImpactCatalogByKeyword(
  catalogId: string,
  keyword: string,
  nextPageId?: string | null
): Promise<{ rows: ResultRow[]; hasMore: boolean; nextAfterId: string | null }> {
  const params: Record<string, string | number> = { keyword, limit: IMPACT_CATALOG_BY_KEYWORD_LIMIT };
  if (nextPageId) {
    params.nextPageId = nextPageId;
  }
  const payload = await http.get(`/api/v1/impact/catalogs/${catalogId}/items/by-keyword`, {
    params
  });
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
  return { rows, hasMore, nextAfterId };
}

async function fetchCjPage(
  keyword: string,
  offset: number,
  nextPageToken: string | null,
  cjAdvertiserId: string
): Promise<{ rows: ResultRow[]; nextOffset: number; nextPageToken: string | null; hasMore: boolean }> {
  const limit = API_PAGE_LIMIT;
  const requestBody: Record<string, unknown> = {
    company_id: "6947255",
    keywords: [keyword],
    advertiser_countries: ["US"],
    availability: "IN_STOCK",
    partner_status: "JOINED",
    partner_ids: [cjAdvertiserId || ""],
    pid: "101105481",
    limit
  };
  const isFirstPage = offset === 0;
  if (!isFirstPage && !nextPageToken) {
    return { rows: [], nextOffset: offset, nextPageToken: null, hasMore: false };
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
  return { rows, nextOffset, nextPageToken: providerNextPage, hasMore };
}

export default function ResultsClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const keyword = (searchParams.get("q") ?? "").trim();
  const useCj = searchParams.get("cj") !== "0";
  const useImpact = searchParams.get("impact") !== "0";
  const cjAdvertiserId = (searchParams.get("cjAdvertiserId") ?? "").trim();
  const impactCampaign = (searchParams.get("impactCampaign") ?? "").trim();
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
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
  const [invalidNoticeCount, setInvalidNoticeCount] = useState(0);
  const cjLastCallAtRef = useRef(0);
  const cjLinkHealthCacheRef = useRef<Map<string, boolean>>(new Map());
  const cjValidationQueueRef = useRef<ValidationQueueItem[]>([]);
  const cjValidationRunningRef = useRef(false);
  const searchEpochRef = useRef(0);
  const impactCampaignMapRef = useRef<Record<string, string[]>>({});
  const impactCatalogAfterIdRef = useRef<Record<string, string | null>>({});

  const cacheKey = useMemo(
    () =>
      `results-cache:v1:${keyword}:${useCj ? "1" : "0"}:${useImpact ? "1" : "0"}:${cjAdvertiserId || "all"}:${impactCampaign || "all"}`,
    [keyword, useCj, useImpact, cjAdvertiserId, impactCampaign]
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
      result: { rows: ResultRow[]; nextOffset: number; nextPageToken?: string | null; hasMore: boolean };
      warnings?: string[];
    }>[] = [];
    if (useCj && state.cjHasMore) {
      if (state.cjOffset > 0 && !state.cjNextPage) {
        state.cjHasMore = false;
      } else {
      tasks.push((async () => {
        await throttleCj();
        const result = await fetchCjPage(keyword, state.cjOffset, state.cjNextPage, cjAdvertiserId);
        return { platform: "CJ" as const, result: { rows: result.rows, nextOffset: result.nextOffset, nextPageToken: result.nextPageToken, hasMore: result.hasMore } };
      })());
      }
    }
    if (useImpact && state.impactHasMore) {
      tasks.push((async () => {
        if (!impactCampaign) {
          const result = await fetchImpactPage(keyword, state.impactOffset);
          return { platform: "Impact" as const, result: { rows: result.rows, nextOffset: result.nextOffset, hasMore: result.hasMore } };
        }

        const campaignMap = await fetchImpactCampaignCatalogMap();
        const catalogIds = campaignMap[impactCampaign] ?? [];
        if (catalogIds.length === 0) {
          return { platform: "Impact" as const, result: { rows: [], nextOffset: state.impactOffset, hasMore: false } };
        }

        const settledCatalogs = await Promise.allSettled(
          catalogIds.map((catalogId) =>
            fetchImpactCatalogByKeyword(
              catalogId,
              keyword,
              impactCatalogAfterIdRef.current[catalogId] ?? null
            )
          )
        );
        const combinedRows: ResultRow[] = [];
        let anyHasMore = false;
        const warnings: string[] = [];
        settledCatalogs.forEach((catalogResult, index) => {
          const catalogId = catalogIds[index];
          if (catalogResult.status === "fulfilled") {
            combinedRows.push(...catalogResult.value.rows);
            impactCatalogAfterIdRef.current[catalogId] = catalogResult.value.nextAfterId;
            if (catalogResult.value.hasMore) anyHasMore = true;
          } else {
            const meta = getErrorMeta(catalogResult.reason);
            warnings.push(meta.message || "Impact catalog fetch failed");
          }
        });
        return {
          platform: "Impact" as const,
          result: { rows: combinedRows, nextOffset: state.impactOffset + API_PAGE_LIMIT, hasMore: anyHasMore },
          warnings
        };
      })());
    }

    const settled = await Promise.allSettled(tasks);
    const nextState: PlatformCursor = { ...state };
    const chunkRows: ResultRow[] = [];
    const failures: FetchFailure[] = [];

    settled.forEach((item) => {
      if (item.status === "rejected") {
        const meta = getErrorMeta(item.reason);
        failures.push({ message: meta.message, retryable: meta.retryable });
        return;
      }
      const { platform, result } = item.value;
      chunkRows.push(...result.rows);
      if (item.value.warnings?.length) {
        item.value.warnings.forEach((warning) => failures.push({ message: warning, retryable: false }));
      }
      if (platform === "CJ") {
        nextState.cjOffset = result.nextOffset;
        nextState.cjNextPage = result.nextPageToken ?? null;
        nextState.cjHasMore = result.hasMore;
      } else {
        nextState.impactOffset = result.nextOffset;
        nextState.impactHasMore = result.hasMore;
      }
    });

    return { chunkRows, nextState, failures };
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
        impactCatalogAfterIdRef.current = {};
        setCjValidationState({});
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
        const { chunkRows, nextState, failures } = await fetchChunk(initialState);
        const deduped = dedupeByTitle(chunkRows);
        setRows(deduped);
        setCursor(nextState);
        const initialSelection = shouldRestore ? buildSelectionState(deduped) : Object.fromEntries(deduped.map((row) => [row.id, false]));
        setSelectedIds(initialSelection);
        queueCjValidation(deduped);
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
  }, [cacheKey, keyword, useCj, useImpact, cjAdvertiserId, impactCampaign]);

  useEffect(() => {
    if (!keyword || !ENABLE_RESULTS_CACHE) return;
    const cachePayload: CachedSearchState = { rows, selectedIds, page, cursor, loadedAt: Date.now() };
    sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
  }, [cacheKey, cursor, keyword, page, rows, selectedIds]);

  const loadMore = async () => {
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
    } catch (requestError) {
      const meta = getErrorMeta(requestError);
      setError(meta.message || "Failed to load more");
      setErrorRetryable(meta.retryable);
      setLastFailedAction("loadMore");
      console.error("[results] load more failed", requestError);
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
  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        if (!ENABLE_CJ_LINK_VALIDATION) return true;
        if (row.platform !== "CJ") return true;
        if (!shouldValidateCjUrl(row)) return true;
        return cjValidationState[row.id] === "valid";
      }),
    [cjValidationState, rows]
  );
  const visibleRows = useMemo(
    () => filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredRows, page]
  );
  const hasNextUiPage = filteredRows.length > page * PAGE_SIZE;
  const hasMoreFromApis = cursor.cjHasMore || cursor.impactHasMore;
  const pendingCjValidations = useMemo(
    () => Object.values(cjValidationState).filter((value) => value === "pending").length,
    [cjValidationState]
  );
  const selectedRows = useMemo(
    () => filteredRows.filter((row) => Boolean(selectedIds[row.id])),
    [filteredRows, selectedIds]
  );

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
      <div className="grid min-h-[calc(100vh-58px)] grid-cols-1 md:grid-cols-[260px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Platform</p>
          <div className="mb-6 flex flex-wrap gap-2 text-xs">
            {useCj ? <span className="badge badge-cj">CJ</span> : null}
            {useImpact ? <span className="badge badge-imp">Impact</span> : null}
            {useCj && useImpact ? <span className="rounded-full border px-2 py-[2px] text-[11px] text-slate-500">Both</span> : null}
          </div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Result info</p>
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
            <p>Page: <span className="font-medium text-slate-800">{page}</span></p>
            <p className="mt-1">Loaded: <span className="font-medium text-slate-800">{rows.length}</span></p>
          </div>
        </aside>

        <main className="p-4 pb-24 md:p-6 md:pb-24">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <input className="field w-full max-w-md" value={`Results for "${keyword || "all products"}"`} readOnly />
          </div>
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
                      No results found.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
          )}
          {!loading ? <div className="mt-3 grid grid-cols-2 items-center text-sm">
            <div className="justify-self-start">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                className="btn-secondary disabled:opacity-50"
              >
                Previous
              </button>
            </div>
            <div className="justify-self-end">
              <button
                type="button"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!hasNextUiPage}
                className="btn-secondary disabled:opacity-50"
              >
                Next Page
              </button>
            </div>
          </div> : null}
          {!loading && !hasNextUiPage && hasMoreFromApis ? (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? "Loading more..." : "Load more results"}
              </button>
            </div>
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
