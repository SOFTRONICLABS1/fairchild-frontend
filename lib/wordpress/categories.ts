"use client";

import { http, unwrapEnvelope } from "@/lib/api/client";

export type WordPressCategoryOption = {
  id: number;
  name: string;
};

const WORDPRESS_CATEGORY_PAGE_SIZE = 100;
const WORDPRESS_CATEGORY_FETCH_CONCURRENCY = 15;
const WORDPRESS_CATEGORY_SESSION_KEY = "wordpress:categories-cache";

let wordpressCategoryCache: WordPressCategoryOption[] | null = null;
let wordpressCategoryPromise: Promise<WordPressCategoryOption[]> | null = null;

function normalizeWordPressCategories(input: unknown): WordPressCategoryOption[] {
  if (!Array.isArray(input)) return [];
  return input
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const category = item as { id?: unknown; name?: unknown };
      const id = Number(category.id);
      const name = typeof category.name === "string" ? category.name.trim() : "";
      if (!Number.isFinite(id) || !name) return null;
      return { id, name };
    })
    .filter((item): item is WordPressCategoryOption => Boolean(item));
}

function extractTotalPagesFromHeaders(headers: Record<string, unknown> | undefined): number | null {
  if (!headers) return null;
  const raw = headers["x-wp-totalpages"] ?? headers["x-total-pages"] ?? headers["x-totalpages"];
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function loadCategoriesFromSession(): WordPressCategoryOption[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(WORDPRESS_CATEGORY_SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    const normalized = normalizeWordPressCategories(parsed);
    return normalized.length > 0 ? normalized : null;
  } catch {
    return null;
  }
}

function saveCategoriesToSession(categories: WordPressCategoryOption[]) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(WORDPRESS_CATEGORY_SESSION_KEY, JSON.stringify(categories));
  } catch {
    // ignore session quota/write errors
  }
}

async function fetchWordPressCategoryPage(page: number): Promise<{
  categories: WordPressCategoryOption[];
  totalPages: number | null;
}> {
  const response = await http.get("/api/v1/wordpress/products/categories", {
    params: {
      per_page: WORDPRESS_CATEGORY_PAGE_SIZE,
      page
    }
  });
  const categories = normalizeWordPressCategories(unwrapEnvelope<unknown>(response.data));
  const totalPages = extractTotalPagesFromHeaders(response.headers as Record<string, unknown> | undefined);
  return { categories, totalPages };
}

async function fetchWordPressCategoriesWithBoundedParallel(totalPages: number): Promise<WordPressCategoryOption[]> {
  const categories: WordPressCategoryOption[] = [];
  for (let start = 2; start <= totalPages; start += WORDPRESS_CATEGORY_FETCH_CONCURRENCY) {
    const pages = Array.from(
      { length: Math.min(WORDPRESS_CATEGORY_FETCH_CONCURRENCY, totalPages - start + 1) },
      (_, index) => start + index
    );
    const batch = await Promise.all(pages.map((page) => fetchWordPressCategoryPage(page)));
    batch.forEach((result) => {
      categories.push(...result.categories);
    });
  }
  return categories;
}

async function fetchWordPressCategoriesWithWindowedDiscovery(): Promise<WordPressCategoryOption[]> {
  const categories: WordPressCategoryOption[] = [];
  let nextPage = 2;
  let shouldContinue = true;

  while (shouldContinue) {
    const pages = Array.from({ length: WORDPRESS_CATEGORY_FETCH_CONCURRENCY }, (_, index) => nextPage + index);
    const batch = await Promise.all(pages.map((page) => fetchWordPressCategoryPage(page)));
    for (const result of batch) {
      if (result.categories.length === 0) {
        shouldContinue = false;
        break;
      }
      categories.push(...result.categories);
    }
    nextPage += WORDPRESS_CATEGORY_FETCH_CONCURRENCY;
  }

  return categories;
}

export async function loadWordPressCategories(): Promise<WordPressCategoryOption[]> {
  if (wordpressCategoryCache) return wordpressCategoryCache;

  const sessionCategories = loadCategoriesFromSession();
  if (sessionCategories) {
    wordpressCategoryCache = sessionCategories;
    return sessionCategories;
  }

  if (wordpressCategoryPromise) return wordpressCategoryPromise;

  wordpressCategoryPromise = (async () => {
    const firstPage = await fetchWordPressCategoryPage(1);
    const categories = [...firstPage.categories];

    if (firstPage.totalPages && firstPage.totalPages > 1) {
      categories.push(...(await fetchWordPressCategoriesWithBoundedParallel(firstPage.totalPages)));
    } else if (firstPage.categories.length > 0) {
      categories.push(...(await fetchWordPressCategoriesWithWindowedDiscovery()));
    }

    const deduped = Array.from(
      categories.reduce((map, category) => map.set(category.id, category), new Map<number, WordPressCategoryOption>()).values()
    );
    wordpressCategoryCache = deduped;
    saveCategoriesToSession(deduped);
    wordpressCategoryPromise = null;
    return deduped;
  })().catch((error) => {
    wordpressCategoryPromise = null;
    throw error;
  });

  return wordpressCategoryPromise;
}

export function preloadWordPressCategories() {
  if (wordpressCategoryCache || loadCategoriesFromSession() || wordpressCategoryPromise) return;
  void loadWordPressCategories().catch(() => {
    // package page remains the visible fallback if preload fails
  });
}
