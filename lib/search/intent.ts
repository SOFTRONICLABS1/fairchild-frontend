/**
 * Shared deal-search intent for /affiliate/search and /results.
 *
 * The URL is the carrier of this state, matching how /results already reads q, cj,
 * impact, cjAdvertiserId and impactCampaign. Both pages read and write it through
 * here so the mapping onto CJ/Impact request parameters lives in exactly one place.
 */

export type SortKey = "relevance" | "discount-desc" | "price-asc" | "price-desc";

export const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "relevance", label: "Best match" },
  { value: "discount-desc", label: "Biggest discount" },
  { value: "price-asc", label: "Lowest price" },
  { value: "price-desc", label: "Highest price" }
];

export const MIN_DISCOUNT_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: "Any" },
  { value: 1, label: "On sale" },
  { value: 25, label: "25%+" },
  { value: 50, label: "50%+" },
  { value: 70, label: "70%+" }
];

/**
 * Impact rejects any other value with a 422 (INVALID_SORT_FIELD). Every sort we send is
 * built from this list, so that error is unreachable by construction.
 */
export const IMPACT_SORT_FIELDS = [
  "DiscountPercentage",
  "CurrentPrice",
  "Name",
  "CatalogItemId",
  "Category",
  "Manufacturer"
] as const;

/** A bare "top discounts" with no percentage means genuinely deep cuts, not any sale. */
export const DEFAULT_DEAL_DISCOUNT = 50;

/**
 * Feed errors that dominate a discount sort: Fanatics rows listed at 100% off for $0.01,
 * plus a tail of 97-99% rows that are equally bogus.
 */
export const JUNK_DISCOUNT_THRESHOLD = 97;
export const JUNK_PRICE_THRESHOLD = 1;

export type SearchIntent = {
  keyword: string;
  dealsEnabled: boolean;
  sort: SortKey;
  minDiscount: number;
  minPrice: number | null;
  maxPrice: number | null;
};

export const DEFAULT_INTENT: SearchIntent = {
  keyword: "",
  dealsEnabled: false,
  sort: "relevance",
  minDiscount: 0,
  minPrice: null,
  maxPrice: null
};

function toSortKey(value: string | null | undefined): SortKey {
  const candidate = (value ?? "").trim();
  return SORT_OPTIONS.some((option) => option.value === candidate) ? (candidate as SortKey) : "relevance";
}

function toPositiveNumber(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function clampDiscount(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

/** True when the intent asks for anything beyond a plain relevance keyword search. */
export function hasActiveFilters(intent: SearchIntent): boolean {
  return (
    intent.sort !== "relevance" ||
    intent.minDiscount > 0 ||
    intent.minPrice !== null ||
    intent.maxPrice !== null
  );
}

export function readIntentFromParams(params: URLSearchParams): SearchIntent {
  const intent: SearchIntent = {
    keyword: (params.get("q") ?? "").trim(),
    dealsEnabled: false,
    sort: toSortKey(params.get("sort")),
    minDiscount: clampDiscount(toPositiveNumber(params.get("minDisc")) ?? 0),
    minPrice: toPositiveNumber(params.get("minPrice")),
    maxPrice: toPositiveNumber(params.get("maxPrice"))
  };
  intent.dealsEnabled = hasActiveFilters(intent);
  return intent;
}

/** Writes intent onto an existing param set, clearing anything back at its default. */
export function writeIntentToParams(params: URLSearchParams, intent: SearchIntent): URLSearchParams {
  const active = intent.dealsEnabled;

  if (intent.keyword) params.set("q", intent.keyword);
  else params.delete("q");

  if (active && intent.sort !== "relevance") params.set("sort", intent.sort);
  else params.delete("sort");

  if (active && intent.minDiscount > 0) params.set("minDisc", String(intent.minDiscount));
  else params.delete("minDisc");

  if (active && intent.minPrice !== null) params.set("minPrice", String(intent.minPrice));
  else params.delete("minPrice");

  if (active && intent.maxPrice !== null) params.set("maxPrice", String(intent.maxPrice));
  else params.delete("maxPrice");

  return params;
}

/**
 * Impact supports server-side sorting AND keeps pagination working, so the sort goes
 * upstream. Numeric filters map straight across.
 */
export function toImpactParams(intent: SearchIntent): Record<string, string | number> {
  const params: Record<string, string | number> = {};
  if (!intent.dealsEnabled) return params;

  if (intent.sort === "discount-desc") {
    params.sortBy = "DiscountPercentage";
    params.sortOrder = "DESC";
  } else if (intent.sort === "price-asc") {
    params.sortBy = "CurrentPrice";
    params.sortOrder = "ASC";
  } else if (intent.sort === "price-desc") {
    params.sortBy = "CurrentPrice";
    params.sortOrder = "DESC";
  }

  if (intent.minDiscount > 0) params.minDiscount = intent.minDiscount;
  if (intent.minPrice !== null) params.minPrice = intent.minPrice;
  if (intent.maxPrice !== null) params.maxPrice = intent.maxPrice;
  return params;
}

/**
 * CJ deliberately gets filters but never sort_by. Its sort enum has no discount option,
 * and setting any sort nulls nextPage — which would kill "Load more". Filtering to
 * >= minDiscount already makes every returned row a deal, so the page is sorted locally.
 */
export function toCjBody(intent: SearchIntent): Record<string, number> {
  const body: Record<string, number> = {};
  if (!intent.dealsEnabled) return body;
  if (intent.minDiscount > 0) body.discount_percentage = intent.minDiscount;
  if (intent.minPrice !== null) body.low_price = intent.minPrice;
  if (intent.maxPrice !== null) body.high_price = intent.maxPrice;
  return body;
}

const STOP_WORDS = new Set([
  "a", "an", "the", "and", "or", "with", "for", "on", "in", "of", "to", "me", "my",
  "show", "find", "get", "give", "list", "want", "need", "please", "some", "any",
  "products", "product", "items", "item", "things", "stuff", "deals", "deal",
  "best", "top", "most", "cheapest", "cheap", "discounted", "discount", "discounts",
  "sale", "sales", "offers", "offer", "under", "over", "below", "above", "less",
  "than", "more", "off", "cj", "impact", "today", "now", "this", "week",
  "between", "from", "up", "at", "least", "max", "maximum", "min", "minimum",
  "percent", "rated", "selling", "new", "arrivals", "cheaper", "expensive"
]);

export function tokenize(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Strips deal language so what remains is the product the user actually named. */
export function extractKeywordFromPrompt(prompt: string): string {
  return tokenize(prompt)
    .filter((word) => !STOP_WORDS.has(word) && !/^\d+$/.test(word))
    .slice(0, 3)
    .join(" ");
}

export type PlatformHint = "cj" | "impact" | "both" | "current";

export type ParsedPrompt = {
  intent: SearchIntent;
  platform: PlatformHint;
};

/**
 * Heuristic parser. Runs before the AI call as a baseline and again as the fallback, so
 * "most discounted" survives even when the Claude endpoint is slow, vague or down.
 */
export function parseIntentLocally(prompt: string): ParsedPrompt {
  const text = prompt.toLowerCase();
  const intent: SearchIntent = {
    ...DEFAULT_INTENT,
    keyword: extractKeywordFromPrompt(prompt)
  };

  const percentMatch = text.match(/(\d{1,3})\s*(?:%|percent)/);
  if (percentMatch) {
    intent.minDiscount = clampDiscount(Number(percentMatch[1]));
    intent.sort = "discount-desc";
  }

  const wantsDeals = /\b(discount|discounts|discounted|deal|deals|sale|clearance|bargain|markdown|off)\b/.test(text);
  if (wantsDeals) {
    intent.sort = "discount-desc";
    if (intent.minDiscount === 0) {
      // "top/best/biggest discounts" means deep cuts; a plain "on sale" means any.
      const wantsTop = /\b(top|best|biggest|highest|most|max|maximum|deepest)\b/.test(text);
      intent.minDiscount = wantsTop ? DEFAULT_DEAL_DISCOUNT : 1;
    }
  }

  if (/\b(cheapest|lowest price|least expensive|budget|affordable)\b/.test(text)) {
    intent.sort = "price-asc";
  }
  if (/\b(most expensive|highest price|premium|luxury)\b/.test(text)) {
    intent.sort = "price-desc";
  }

  const between = text.match(/between\s*\$?\s*(\d+(?:\.\d+)?)\s*(?:and|-|to)\s*\$?\s*(\d+(?:\.\d+)?)/);
  if (between) {
    intent.minPrice = Number(between[1]);
    intent.maxPrice = Number(between[2]);
  } else {
    const under = text.match(/(?:under|below|less than|cheaper than|up to|max)\s*\$?\s*(\d+(?:\.\d+)?)/);
    if (under) intent.maxPrice = Number(under[1]);
    const over = text.match(/(?:over|above|more than|at least|from)\s*\$?\s*(\d+(?:\.\d+)?)/);
    if (over) intent.minPrice = Number(over[1]);
  }

  intent.dealsEnabled = hasActiveFilters(intent);

  let platform: PlatformHint = "current";
  const mentionsCj = /\bcj\b|commission junction/.test(text);
  const mentionsImpact = /\bimpact\b/.test(text);
  if (/\b(both|all platforms|everywhere)\b/.test(text)) platform = "both";
  else if (mentionsCj && mentionsImpact) platform = "both";
  else if (mentionsCj) platform = "cj";
  else if (mentionsImpact) platform = "impact";

  return { intent, platform };
}

export type ScorableRow = {
  product: string;
  companyName: string;
  price: number;
  discount: number;
};

export function isJunkRow(row: ScorableRow): boolean {
  return row.discount >= JUNK_DISCOUNT_THRESHOLD || row.price < JUNK_PRICE_THRESHOLD;
}

/**
 * Both platforms return loose keyword matches, so this is what pulls the genuinely
 * relevant rows onto page 1 rather than leaving them buried.
 */
export function scoreRelevance(row: ScorableRow, keyword: string): number {
  const terms = tokenize(keyword);
  if (terms.length === 0) return 0;

  const title = row.product.toLowerCase();
  const company = row.companyName.toLowerCase();
  let score = 0;
  let matched = 0;

  if (title.includes(keyword.toLowerCase().trim())) score += 100;

  terms.forEach((term) => {
    if (title.includes(term)) {
      matched += 1;
      score += 20;
      if (new RegExp(`\\b${term}`).test(title)) score += 10;
    } else if (company.includes(term)) {
      matched += 1;
      score += 8;
    }
  });

  if (matched === terms.length) score += 40;
  return score;
}

/**
 * Filters junk and orders rows. For Impact the server already sorted, but CJ rows and the
 * merged cross-platform list still need ordering, so this runs over the combined set.
 */
export function applyIntent<T extends ScorableRow>(rows: T[], intent: SearchIntent): T[] {
  const scored = rows
    .filter((row) => !isJunkRow(row))
    .map((row) => ({ row, score: scoreRelevance(row, intent.keyword) }));

  scored.sort((a, b) => {
    switch (intent.sort) {
      case "discount-desc":
        if (b.row.discount !== a.row.discount) return b.row.discount - a.row.discount;
        return b.score - a.score;
      case "price-asc":
        if (a.row.price !== b.row.price) return a.row.price - b.row.price;
        return b.score - a.score;
      case "price-desc":
        if (b.row.price !== a.row.price) return b.row.price - a.row.price;
        return b.score - a.score;
      default:
        if (b.score !== a.score) return b.score - a.score;
        return b.row.discount - a.row.discount;
    }
  });

  return scored.map((item) => item.row);
}

export function describeIntent(intent: SearchIntent): Array<{ key: keyof SearchIntent; label: string }> {
  if (!intent.dealsEnabled) return [];
  const chips: Array<{ key: keyof SearchIntent; label: string }> = [];

  if (intent.sort !== "relevance") {
    const label = SORT_OPTIONS.find((option) => option.value === intent.sort)?.label;
    if (label) chips.push({ key: "sort", label });
  }
  if (intent.minDiscount > 0) {
    chips.push({ key: "minDiscount", label: intent.minDiscount === 1 ? "On sale" : `${intent.minDiscount}%+ off` });
  }
  if (intent.minPrice !== null && intent.maxPrice !== null) {
    chips.push({ key: "minPrice", label: `$${intent.minPrice} – $${intent.maxPrice}` });
  } else if (intent.maxPrice !== null) {
    chips.push({ key: "maxPrice", label: `Under $${intent.maxPrice}` });
  } else if (intent.minPrice !== null) {
    chips.push({ key: "minPrice", label: `Over $${intent.minPrice}` });
  }
  return chips;
}

/** Removing a chip clears that one dimension, switching Deals off once nothing is left. */
export function clearIntentKey(intent: SearchIntent, key: keyof SearchIntent): SearchIntent {
  const next: SearchIntent = { ...intent };
  if (key === "sort") next.sort = "relevance";
  if (key === "minDiscount") next.minDiscount = 0;
  if (key === "minPrice") {
    next.minPrice = null;
    next.maxPrice = null;
  }
  if (key === "maxPrice") next.maxPrice = null;
  next.dealsEnabled = hasActiveFilters(next);
  return next;
}

/** Shown instead of alternate keywords when a deal browse has no product term to vary. */
export const BROWSE_SUGGESTIONS = ["shoes", "electronics", "jewelry", "outdoor", "home"];

/**
 * Advertiser selections are multi-value and travel as comma-separated params. The legacy
 * singular params are still read so older saved links and sessions keep working.
 */
export function readSelectionParam(
  params: URLSearchParams,
  pluralKey: string,
  legacyKey: string
): string[] {
  const raw = params.get(pluralKey);
  if (raw !== null) {
    return raw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  const legacy = (params.get(legacyKey) ?? "").trim();
  return legacy ? [legacy] : [];
}

export function writeSelectionParam(
  params: URLSearchParams,
  pluralKey: string,
  legacyKey: string,
  values: string[]
): void {
  params.delete(legacyKey);
  const cleaned = values.map((value) => value.trim()).filter(Boolean);
  if (cleaned.length > 0) params.set(pluralKey, cleaned.join(","));
  else params.delete(pluralKey);
}
