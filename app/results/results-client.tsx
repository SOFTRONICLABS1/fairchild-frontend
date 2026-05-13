"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import { http, unwrapEnvelope } from "@/lib/api/client";

const PAGE_SIZE = 50;
const API_PAGE_LIMIT = 100;
const CACHE_TTL_MS = 5 * 60 * 1000;
const ENABLE_RESULTS_CACHE = false;

type ResultRow = {
  rowKey: string;
  id: string;
  product: string;
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
  link: string;
  imageLink: string;
  price?: { amount?: string | number | null } | null;
  salePrice?: { amount?: string | number | null } | null;
};

type ImpactItem = {
  Id: string;
  CatalogId?: string;
  Name: string;
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
    .filter((item) => item.IsParent === true)
    .map((item) => {
    const currentPrice = toNumber(item.CurrentPrice);
    const originalPrice = toNumber(item.OriginalPrice) || currentPrice;
    return {
      rowKey: `impact-${item.Id}-${item.CatalogId ?? ""}`,
      id: `impact-${item.Id}`,
      product: item.Name,
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
      imageUrl: item.imageLink,
      productUrl: item.link,
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
        if (!keyword) {
          setRows([]);
          setSelectedIds({});
          setCursor({ cjOffset: 0, cjNextPage: null, cjHasMore: useCj, impactOffset: 0, impactHasMore: useImpact });
          return;
        }

        if (ENABLE_RESULTS_CACHE) {
          const rawCache = sessionStorage.getItem(cacheKey);
          if (rawCache) {
            const cached = JSON.parse(rawCache) as CachedSearchState;
            if (Date.now() - cached.loadedAt < CACHE_TTL_MS) {
              setRows(cached.rows);
              setCursor(cached.cursor);
              const cachedSelection: Record<string, boolean> = {};
              cached.rows.forEach((row) => { cachedSelection[row.id] = false; });
              setSelectedIds(cachedSelection);
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
        const initialSelection: Record<string, boolean> = {};
        deduped.forEach((row) => { initialSelection[row.id] = false; });
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
    const cachePayload: CachedSearchState = { rows, cursor, loadedAt: Date.now() };
    sessionStorage.setItem(cacheKey, JSON.stringify(cachePayload));
  }, [cacheKey, cursor, keyword, rows]);

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
    const payload = selectedRows.map((row) => ({
      id: row.id,
      product: row.product,
      imageUrl: row.imageUrl,
      productUrl: row.productUrl,
      platform: row.platform,
      price: row.price,
      discount: row.discount
    }));
    sessionStorage.setItem("pipeline:selected-products", JSON.stringify(payload));
    router.push("/pipeline");
  };

  return (
    <>
      <TopNav right={<div className="text-sm text-slate-500">Search / <span className="font-medium text-slate-800">Results</span></div>} />
      <div className="grid min-h-[calc(100vh-58px)] grid-cols-1 md:grid-cols-[220px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Platform</p>
          <div className="mb-5 flex gap-2 text-xs">
            {useCj ? <span className="badge badge-cj">CJ</span> : null}
            {useImpact ? <span className="badge badge-imp">Impact</span> : null}
            {useCj && useImpact ? <span className="rounded-full border px-2 py-[2px] text-[11px] text-slate-500">Both</span> : null}
          </div>
        </aside>

        <main className="p-4 md:p-6">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <input className="field w-full max-w-md" value={`Results for "${keyword || "all products"}"`} readOnly />
          </div>
          <p className="mb-2 text-xs text-slate-500">
            {loading ? "Loading results..." : `Showing ${visibleRows.length} of ${rows.length} loaded · ${selectedCount} selected`}
          </p>
          {error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}

          <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full min-w-[980px] border-collapse">
              <thead className="bg-slate-50 text-left text-xs text-slate-500">
                <tr>
                  <th className="p-3">Product</th>
                  <th>Image</th>
                  <th>Platform</th>
                  <th>Price</th>
                  <th>Discount</th>
                  <th className="pr-3 text-right">Select</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr key={row.rowKey}>
                    <td className="border-t border-slate-200 p-3">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{row.product}</p>
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
                    <td className="border-t border-slate-200 text-sm">
                      <span className={`badge ${row.platform === "CJ" ? "badge-cj" : "badge-imp"}`}>{row.platform}</span>
                    </td>
                    <td className="border-t border-slate-200 text-sm">{toCurrency(row.price)}</td>
                    <td className="border-t border-slate-200 text-sm">
                      <span className="rounded-full bg-emerald-50 px-2 py-[2px] text-xs text-emerald-700">{row.discount}%</span>
                    </td>
                    <td className="border-t border-slate-200 pr-3 text-right text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedIds[row.id])}
                        onChange={(event) =>
                          setSelectedIds((prev) => ({ ...prev, [row.id]: event.target.checked }))
                        }
                      />
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
          <div className="mt-3 flex items-center justify-between text-sm">
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((prev) => Math.max(1, prev - 1))}
                disabled={page === 1}
                className="btn-secondary disabled:opacity-50"
              >
                Previous
              </button>
              <button
                type="button"
                onClick={() => setPage((prev) => prev + 1)}
                disabled={!hasNextUiPage}
                className="btn-secondary disabled:opacity-50"
              >
                Next Page
              </button>
            </div>
            {!hasNextUiPage && hasMoreFromApis ? (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="text-xs text-[#185FA5] underline disabled:opacity-50"
              >
                {loadingMore ? "Loading more..." : "Load more"}
              </button>
            ) : null}
          </div>

          <div className="mt-4 flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm text-slate-500"><span className="font-medium text-slate-900">{selectedCount}</span> products selected</p>
            <div className="flex gap-2">
              <Link href="/search" className="btn-secondary">Refine search</Link>
              <button type="button" onClick={handleBuildPostPackage} className="btn-primary">Build post package</button>
            </div>
          </div>
          {preview ? (
            <div className="fixed right-6 top-20 z-40 w-[420px] rounded-xl border border-slate-300 bg-white p-3 shadow-2xl">
              <div className="mb-2 flex items-center justify-between">
                <p className="truncate text-sm font-medium">{preview.title}</p>
                <button type="button" onClick={() => setPreview(null)} className="text-slate-500">✕</button>
              </div>
              <img src={preview.url} alt={preview.title} className="h-[320px] w-full rounded-lg object-contain bg-slate-50" />
            </div>
          ) : null}
        </main>
      </div>
    </>
  );
}
