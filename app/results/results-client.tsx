"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";

const PAGE_SIZE = 50;
const API_PAGE_LIMIT = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const ENABLE_RESULTS_CACHE = true;
const ENABLE_CJ_LINK_VALIDATION = false;

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
    const key = `impact:${normalizeTitle(row.product)}`;
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

  const cjById = new Map<string, ResultRow>();
  for (const row of cjByTitle.values()) {
    const key = `cj-id:${row.id}`;
    const existing = cjById.get(key);
    if (!existing || row.discount > existing.discount) {
      cjById.set(key, row);
    }
  }

  return [...Array.from(cjById.values()), ...Array.from(impactUnique.values())];
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

async function fetchCjPage(
  keyword: string,
  offset: number,
  nextPageToken: string | null
): Promise<{ rows: ResultRow[]; nextOffset: number; nextPageToken: string | null; hasMore: boolean }> {
  const limit = API_PAGE_LIMIT;
  const requestBody: Record<string, unknown> = {
    company_id: "6947255",
    keywords: [keyword],
    advertiser_countries: ["US"],
    availability: "IN_STOCK",
    partner_status: "JOINED",
    partner_ids: [""],
    pid: "101105481",
    limit
  };
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
  const hasMore = list.length > 0;
  console.debug("[results] cj response", { rawCount: list.length, count: rows.length, nextOffset, total, hasMore, providerNextPage });
  return { rows, nextOffset, nextPageToken: providerNextPage, hasMore };
}

export default function ResultsClientPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const keyword = (searchParams.get("q") ?? "").trim();
  const useCj = searchParams.get("cj") !== "0";
  const useImpact = searchParams.get("impact") !== "0";
  const [rows, setRows] = useState<ResultRow[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<PlatformCursor>({
    cjOffset: 0,
    cjNextPage: null,
    cjHasMore: useCj,
    impactOffset: 0,
    impactHasMore: useImpact
  });
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);
  const cjLastCallAtRef = useRef(0);
  const cjLinkHealthCacheRef = useRef<Map<string, boolean>>(new Map());

  const cacheKey = useMemo(
    () => `results-cache:v1:${keyword}:${useCj ? "1" : "0"}:${useImpact ? "1" : "0"}`,
    [keyword, useCj, useImpact]
  );

  useEffect(() => {
    const params = searchParams.toString();
    const href = params ? `/results?${params}` : "/results";
    sessionStorage.setItem("pipeline:last-results-url", href);
  }, [searchParams]);

  const throttleCj = async () => {
    const now = Date.now();
    const waitMs = Math.max(0, 2500 - (now - cjLastCallAtRef.current));
    if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
    cjLastCallAtRef.current = Date.now();
  };

  const fetchChunk = async (state: PlatformCursor) => {
    const tasks: Promise<{ platform: "CJ" | "Impact"; result: { rows: ResultRow[]; nextOffset: number; nextPageToken?: string | null; hasMore: boolean } }>[] = [];
    if (useCj && state.cjHasMore) {
      tasks.push((async () => {
        await throttleCj();
        const result = await fetchCjPage(keyword, state.cjOffset, state.cjNextPage);
        return { platform: "CJ" as const, result: { rows: result.rows, nextOffset: result.nextOffset, nextPageToken: result.nextPageToken, hasMore: result.hasMore } };
      })());
    }
    if (useImpact && state.impactHasMore) {
      tasks.push((async () => {
        const result = await fetchImpactPage(keyword, state.impactOffset);
        return { platform: "Impact" as const, result: { rows: result.rows, nextOffset: result.nextOffset, hasMore: result.hasMore } };
      })());
    }

    const settled = await Promise.allSettled(tasks);
    const nextState: PlatformCursor = { ...state };
    const chunkRows: ResultRow[] = [];
    const failures: string[] = [];

    settled.forEach((item) => {
      if (item.status === "rejected") {
        failures.push(item.reason instanceof Error ? item.reason.message : "Unknown API error");
        return;
      }
      const { platform, result } = item.value;
      chunkRows.push(...result.rows);
      if (platform === "CJ") {
        nextState.cjOffset = result.nextOffset;
        nextState.cjNextPage = result.nextPageToken ?? null;
        nextState.cjHasMore = result.hasMore;
      } else {
        nextState.impactOffset = result.nextOffset;
        nextState.impactHasMore = result.hasMore;
      }
    });

    if (!ENABLE_CJ_LINK_VALIDATION) {
      return { chunkRows, nextState, failures };
    }

    const cjRows = chunkRows.filter((row) => row.platform === "CJ");
    const nonCjRows = chunkRows.filter((row) => row.platform !== "CJ");
    const validatedCjRows: ResultRow[] = [];

    for (const row of cjRows) {
      if (!row.productUrl) continue;
      const cached = cjLinkHealthCacheRef.current.get(row.productUrl);
      if (cached !== undefined) {
        if (cached) validatedCjRows.push(row);
        continue;
      }

      try {
        const response = await fetch(`/api/url-health?url=${encodeURIComponent(row.productUrl)}`);
        const payload = (await response.json()) as { ok?: boolean };
        const isHealthy = payload.ok === true;
        cjLinkHealthCacheRef.current.set(row.productUrl, isHealthy);
        if (isHealthy) validatedCjRows.push(row);
      } catch {
        cjLinkHealthCacheRef.current.set(row.productUrl, false);
      }
    }

    return { chunkRows: [...validatedCjRows, ...nonCjRows], nextState, failures };
  };

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      setPage(1);
      try {
        const shouldRestore = sessionStorage.getItem("pipeline:allow-results-restore") === "1";
        sessionStorage.removeItem("pipeline:allow-results-restore");

        if (ENABLE_RESULTS_CACHE) {
          const rawCache = sessionStorage.getItem(cacheKey);
          if (rawCache && shouldRestore) {
            const cached = JSON.parse(rawCache) as CachedSearchState;
            if (Date.now() - cached.loadedAt < CACHE_TTL_MS) {
              setRows(cached.rows);
              setCursor(cached.cursor);
              setSelectedIds(cached.selectedIds ?? buildSelectionState(cached.rows));
              setPage(cached.page ?? 1);
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
        if (failures.length) setError(failures.join(" | "));
        console.debug("[results] initial load completed", {
          keyword,
          useCj,
          useImpact,
          loadedRows: deduped.length,
          failures
        });
      } catch (requestError) {
        const msg = requestError instanceof Error ? requestError.message : "Failed to fetch results";
        setError(msg);
        setRows([]);
        console.error("[results] initial load failed", requestError);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, [cacheKey, keyword, useCj, useImpact]);

  useEffect(() => {
    if (!keyword || !ENABLE_RESULTS_CACHE) return;
    const cachePayload: CachedSearchState = { rows, selectedIds, page, cursor, loadedAt: Date.now() };
    sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
  }, [cacheKey, cursor, keyword, page, rows, selectedIds]);

  const loadMore = async () => {
    setLoadingMore(true);
    setError(null);
    try {
      const { chunkRows, nextState, failures } = await fetchChunk(cursor);
      const merged = dedupeByTitle([...rows, ...chunkRows]);
      setRows(merged);
      setCursor(nextState);
      setSelectedIds((prev) => {
        const next = { ...prev };
        merged.forEach((row) => {
          if (next[row.id] === undefined) next[row.id] = false;
        });
        return next;
      });
      if (failures.length) setError(failures.join(" | "));
      console.debug("[results] load more completed", {
        addedRows: chunkRows.length,
        totalRows: merged.length,
        failures
      });
    } catch (requestError) {
      const msg = requestError instanceof Error ? requestError.message : "Failed to load more";
      setError(msg);
      console.error("[results] load more failed", requestError);
    } finally {
      setLoadingMore(false);
    }
  };

  const selectedCount = useMemo(
    () => Object.values(selectedIds).filter(Boolean).length,
    [selectedIds]
  );
  const visibleRows = useMemo(
    () => rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [page, rows]
  );
  const hasNextUiPage = rows.length > page * PAGE_SIZE;
  const hasMoreFromApis = cursor.cjHasMore || cursor.impactHasMore;
  const selectedRows = useMemo(
    () => rows.filter((row) => Boolean(selectedIds[row.id])),
    [rows, selectedIds]
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
            {loading ? "Loading results..." : `Showing ${visibleRows.length} of ${rows.length} loaded · ${selectedCount} selected`}
          </p>
          {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

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
                      <span className={`badge ${row.platform === "CJ" ? "badge-cj" : "badge-imp"}`}>{row.platform}</span>
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
              <button type="button" onClick={handleBuildPostPackage} className="btn-primary">Review selection → Step 3</button>
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
