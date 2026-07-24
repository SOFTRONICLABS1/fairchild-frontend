"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { getDisplayMessage } from "@/lib/api/errors";
import { generateJson } from "@/lib/ai/generate";
import DealsPanel from "@/components/search/deals-panel";
import MultiSelectChips from "@/components/search/multi-select-chips";
import { usePlatformOptions } from "@/lib/search/use-platform-options";
import {
  writeSelectionParam,
  BROWSE_SUGGESTIONS,
  DEFAULT_DEAL_DISCOUNT,
  DEFAULT_INTENT,
  SORT_OPTIONS,
  clampDiscount,
  hasActiveFilters,
  parseIntentLocally,
  writeIntentToParams,
  type PlatformHint,
  type SearchIntent,
  type SortKey
} from "@/lib/search/intent";

function PlatformCard({ active, code, title, subtitle, tone, onClick }: { active: boolean; code: string; title: string; subtitle: string; tone: "cj" | "imp"; onClick: () => void; }) {
  return (
    <button onClick={onClick} className={`card p-4 text-left transition ${active ? "border-2 border-[#185FA5]" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className={`grid h-8 w-8 place-items-center rounded-md text-xs font-semibold ${tone === "cj" ? "bg-[#E6F1FB] text-[#0C447C]" : "bg-[#EEEDFE] text-[#3C3489]"}`}>{code}</div>
        <div className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${active ? "border-[#185FA5] bg-[#185FA5] text-white" : "border-slate-300 text-slate-300"}`}>{active ? "✓" : ""}</div>
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </button>
  );
}

export default function AffiliateSearchPage() {
  const router = useRouter();
  const [cj, setCj] = useState(true);
  const [impact, setImpact] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAlternates, setAiAlternates] = useState<string[]>([]);
  const [aiBrowseMode, setAiBrowseMode] = useState(false);
  const [keywordHelpOpen, setKeywordHelpOpen] = useState(false);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [intent, setIntent] = useState<SearchIntent>(DEFAULT_INTENT);
  const [selectedCjAdvertiserIds, setSelectedCjAdvertiserIds] = useState<string[]>([]);
  const [selectedImpactCampaigns, setSelectedImpactCampaigns] = useState<string[]>([]);

  const {
    cjAdvertisers,
    cjLoading: cjAdvertisersLoading,
    cjError: cjAdvertisersError,
    impactCampaigns,
    impactLoading: impactCampaignLoading,
    impactError: impactCampaignError
  } = usePlatformOptions({ cj, impact });

  useEffect(() => {
    const readList = (key: string, legacyKey: string): string[] => {
      const raw = sessionStorage.getItem(key);
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as string[];
          if (Array.isArray(parsed)) return parsed.filter(Boolean);
        } catch {
          // fall through to the legacy single value
        }
      }
      const legacy = sessionStorage.getItem(legacyKey);
      return legacy ? [legacy] : [];
    };
    setSelectedCjAdvertiserIds(readList("search:cj-advertiser-ids", "search:cj-advertiser-id"));
    setSelectedImpactCampaigns(readList("search:impact-campaigns", "search:impact-campaign"));
  }, []);

  useEffect(() => {
    sessionStorage.setItem("search:cj-advertiser-ids", JSON.stringify(selectedCjAdvertiserIds));
  }, [selectedCjAdvertiserIds]);

  useEffect(() => {
    sessionStorage.setItem("search:impact-campaigns", JSON.stringify(selectedImpactCampaigns));
  }, [selectedImpactCampaigns]);

  const comingSoon = () => {
    window.alert("Coming soon");
  };

  /**
   * "current" means the user never named a platform, so their existing toggles stand —
   * asking for "top discounts" should not silently switch what they had selected.
   */
  const resolvePlatforms = (platform: PlatformHint): { useCj: boolean; useImpact: boolean } => {
    if (platform === "cj") return { useCj: true, useImpact: false };
    if (platform === "impact") return { useCj: false, useImpact: true };
    if (platform === "both") return { useCj: true, useImpact: true };
    if (!cj && !impact) return { useCj: true, useImpact: true };
    return { useCj: cj, useImpact: impact };
  };

  const goToResults = (nextIntent: SearchIntent, useCj: boolean, useImpact: boolean) => {
    const params = new URLSearchParams({
      cj: useCj ? "1" : "0",
      impact: useImpact ? "1" : "0"
    });
    writeIntentToParams(params, nextIntent);
    writeSelectionParam(params, "cjAdvertiserIds", "cjAdvertiserId", useCj ? selectedCjAdvertiserIds : []);
    writeSelectionParam(params, "impactCampaigns", "impactCampaign", useImpact ? selectedImpactCampaigns : []);
    router.push(`/results?${params.toString()}`);
  };

  const runSearch = (overrideKeyword?: string) => {
    const trimmed = (overrideKeyword ?? keyword).trim();
    if (/^(https?:\/\/|www\.)/i.test(trimmed)) {
      setKeywordError("Enter a related keyword. Example: 'Nike shoes'. Product URLs are not supported for keyword search.");
      return;
    }
    setKeywordError(null);
    // An empty box means "browse", which the platforms handle natively. Sending a
    // placeholder like "all products" would be text-matched literally and return
    // items whose names contain the word "products".
    goToResults({ ...intent, keyword: trimmed }, cj || (!cj && !impact), impact || (!cj && !impact));
  };

  const runAiSearch = async () => {
    const promptInput = aiQuery.trim();
    if (!promptInput) return;

    setAiLoading(true);
    setAiError(null);
    // Parsed locally first, so deal intent survives a slow, vague or failed AI call.
    const local = parseIntentLocally(promptInput);
    try {
      const contextPrompt = `
You are a query parser for affiliate product search.
Convert user request into strict JSON for frontend use.

Return ONLY valid JSON, no explanation:
{
  "keyword": "string",
  "alternateKeywords": ["string", "string"],
  "platform": "cj" | "impact" | "both" | "current",
  "sort": "relevance" | "discount-desc" | "price-asc" | "price-desc",
  "minDiscount": number,
  "minPrice": number | null,
  "maxPrice": number | null
}

Keyword rules:
- "keyword" must be a SHORT product-like search term (1 to 3 words max).
- keyword holds ONLY the product, never the deal wording. "most discounted running shoes"
  => keyword "running shoes".
- prefer concrete nouns such as shoes, earbuds, mouse, keyboard, dog food, sunglasses.
- keep keyword lowercase except brand/model names.
- If the user names NO product at all ("top discounts", "best deals today"), return an
  EMPTY keyword "". Do not invent a product. An empty keyword browses everything, which is
  exactly right for a pure deal request.
- "alternateKeywords": up to 3 short candidates (1 to 3 words each) different from
  "keyword". Return an empty array when keyword is empty.

Deal intent rules - the deal wording goes HERE, it is never dropped:
- "most/top/biggest discounts", "best deals", "clearance" => sort "discount-desc" and
  minDiscount ${DEFAULT_DEAL_DISCOUNT} (deep cuts are what "top" means).
- a plain "on sale" with no superlative => sort "discount-desc" and minDiscount 1.
- an explicit percentage wins over both: "60% off or more", "at least 30% off" =>
  minDiscount 60 / 30 with sort "discount-desc".
- "cheapest", "budget", "affordable" => sort "price-asc".
- "most expensive", "premium", "luxury" => sort "price-desc".
- "under $50" => maxPrice 50. "over $20" => minPrice 20. "between $20 and $50" => both.
  Otherwise null.
- No deal wording at all => sort "relevance", minDiscount 0, both prices null.

Platform rules:
- CJ only => "cj". Impact only => "impact". Both/all => "both".
- Platform NOT mentioned => "current". Never guess a platform the user did not name.
- Never return markdown.

User request: ${promptInput}
`.trim();

      const parsed = await generateJson<{
        keyword?: string;
        alternateKeywords?: string[];
        platform?: string;
        sort?: string;
        minDiscount?: number;
        minPrice?: number | null;
        maxPrice?: number | null;
      }>({
        prompt: contextPrompt,
        maxTokens: 500,
        temperature: 0.2
      });

      const normalizedKeyword = (parsed.keyword ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .split(" ")
        .slice(0, 3)
        .join(" ");
      // These are deal phrases, not products. They belong in the intent fields, so if the
      // model still put one in "keyword" treat it as no product term at all.
      const dealPhrases = new Set([
        "discounted products", "best products", "top products", "offers", "best offer",
        "product deals", "top discounts", "best deals", "all products", "deals"
      ]);
      let nextKeyword = dealPhrases.has(normalizedKeyword.toLowerCase()) ? "" : normalizedKeyword;
      if (!nextKeyword) nextKeyword = local.intent.keyword;
      // Still empty is a legitimate outcome: a pure deal browse has no product term.

      const alternateCandidates = Array.isArray(parsed.alternateKeywords) ? parsed.alternateKeywords : [];
      const alternates = alternateCandidates
        .map((value) =>
          String(value ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .split(" ")
            .slice(0, 3)
            .join(" ")
        )
        .filter(Boolean)
        .filter((value) => value.toLowerCase() !== nextKeyword.toLowerCase())
        .filter((value, index, arr) => arr.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
        .slice(0, 3);

      const platformValue = (parsed.platform ?? "").toLowerCase();
      const platform: PlatformHint = ["cj", "impact", "both", "current"].includes(platformValue)
        ? (platformValue as PlatformHint)
        : local.platform;
      const { useCj, useImpact } = resolvePlatforms(platform);

      const aiSort = SORT_OPTIONS.some((option) => option.value === parsed.sort)
        ? (parsed.sort as SortKey)
        : local.intent.sort;
      const aiMinDiscount = Number.isFinite(Number(parsed.minDiscount))
        ? clampDiscount(Number(parsed.minDiscount))
        : local.intent.minDiscount;
      const toPrice = (value: number | null | undefined, fallback: number | null) => {
        if (value === null || value === undefined) return fallback;
        const parsedValue = Number(value);
        return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue : fallback;
      };

      const nextIntent: SearchIntent = {
        keyword: nextKeyword,
        dealsEnabled: false,
        // The local parser wins where the model returned nothing, so "most discounted"
        // still filters even if the model answered with a bare relevance sort.
        sort: local.intent.sort !== "relevance" && aiSort === "relevance" ? local.intent.sort : aiSort,
        minDiscount: Math.max(aiMinDiscount, local.intent.minDiscount),
        minPrice: toPrice(parsed.minPrice, local.intent.minPrice),
        maxPrice: toPrice(parsed.maxPrice, local.intent.maxPrice)
      };
      nextIntent.dealsEnabled = hasActiveFilters(nextIntent);

      setKeyword(nextKeyword);
      setCj(useCj);
      setImpact(useImpact);
      setIntent(nextIntent);
      // With no product term there is nothing to vary, so offer categories to narrow into.
      setAiBrowseMode(!nextKeyword);
      setAiAlternates(nextKeyword ? alternates : []);

      goToResults(nextIntent, useCj, useImpact);
    } catch (error) {
      // Never dead-end on an AI failure. The local parser already understands the common
      // deal phrasings, so run the search it derived instead of showing only an error.
      const fallbackIntent = local.intent;
      const { useCj, useImpact } = resolvePlatforms(local.platform);
      setAiError(
        `${getDisplayMessage(error) || "AI search failed"} — searching with the filters we could read from your question.`
      );
      setKeyword(fallbackIntent.keyword);
      setCj(useCj);
      setImpact(useImpact);
      setIntent(fallbackIntent);
      setAiBrowseMode(!fallbackIntent.keyword);
      setAiAlternates([]);
      goToResults(fallbackIntent, useCj, useImpact);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <>
      <TopNav
        right={
          <>
            <Link href="/search" className="btn-secondary">Back</Link>
            <span className="text-xs text-slate-500">All systems live</span>
            <button type="button" className="btn-secondary" onClick={comingSoon}>History</button>
            <button type="button" className="btn-secondary" onClick={comingSoon}>Settings</button>
          </>
        }
      />
      <FlowStepper active={1} />
      <div className="page-wrap">
        <div className="mx-auto max-w-[620px] text-center">
          <h1 className="mb-1 text-[22px] font-medium">What would you like to post today?</h1>
          <p className="mb-8 text-sm text-slate-500">Search products from your affiliate platforms and publish them in one click.</p>

          <div className="mb-5">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-400">Affiliate Workflow</p>
          </div>

          <div className="mb-5 grid grid-cols-2 gap-3">
            <PlatformCard active={cj} code="CJ" title="CJ Affiliate" subtitle="Commission Junction" tone="cj" onClick={() => setCj((v) => !v)} />
            <PlatformCard active={impact} code="IM" title="Impact" subtitle="Impact.com partnerships" tone="imp" onClick={() => setImpact((v) => !v)} />
          </div>
          {cj ? (
            <MultiSelectChips
              label="CJ Advertisers"
              options={cjAdvertisers}
              selected={selectedCjAdvertiserIds}
              onChange={setSelectedCjAdvertiserIds}
              loading={cjAdvertisersLoading}
              error={cjAdvertisersError}
              emptyLabel="All advertisers"
            />
          ) : null}
          {impact ? (
            <MultiSelectChips
              label="Impact Advertisers"
              options={impactCampaigns}
              selected={selectedImpactCampaigns}
              onChange={setSelectedImpactCampaigns}
              loading={impactCampaignLoading}
              error={impactCampaignError}
              emptyLabel="All advertisers"
            />
          ) : null}

          <DealsPanel intent={intent} onChange={setIntent} />

          <div className="card mb-4 flex items-center gap-2 px-3 py-2">
            <span className="text-slate-400">⌕</span>
            <input
              className="w-full border-none bg-transparent text-sm outline-none"
              placeholder={intent.dealsEnabled ? "Product name, or leave empty for all products..." : "Search products e.g. wireless headphones..."}
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
            <button type="button" onClick={() => runSearch()} className="btn-primary">Search</button>
            <div className="relative">
              <button type="button" onClick={() => setKeywordHelpOpen((prev) => !prev)} className="grid h-7 w-7 place-items-center rounded-full border border-slate-300 text-xs text-slate-500" aria-label="Keyword help">ℹ</button>
              {keywordHelpOpen ? (
                <div className="absolute right-0 top-9 z-20 w-64 rounded-lg border border-slate-200 bg-white p-2 text-left text-xs text-slate-600 shadow-lg">
                  Enter a related keyword. Example: 'Nike shoes'. Product URLs are not supported for keyword search.
                </div>
              ) : null}
            </div>
          </div>
          {keywordError ? <p className="mb-3 text-sm text-red-600">{keywordError}</p> : null}

          <div className="mb-5 mt-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-slate-200" />
            <span className="text-xs font-medium uppercase tracking-wide text-slate-400">OR ASK AI</span>
            <div className="h-px flex-1 bg-slate-200" />
          </div>

          <div className="card mb-3 flex items-center gap-2 px-3 py-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#E6F1FB] text-[#185FA5]">✦</span>
            <input
              className="w-full border-none bg-transparent text-sm outline-none"
              placeholder='e.g. "most discounted electronics on CJ"'
              value={aiQuery}
              onChange={(event) => setAiQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void runAiSearch();
                }
              }}
            />
            <button type="button" onClick={() => void runAiSearch()} disabled={aiLoading} className="rounded-md bg-gradient-to-r from-[#185FA5] to-[#6366F1] px-3 py-2 text-xs font-medium text-white">
              {aiLoading ? "Thinking..." : "Ask AI"}
            </button>
          </div>
          {aiError ? <p className="mb-3 text-sm text-amber-700">{aiError}</p> : null}
          {aiBrowseMode ? (
            <div className="mb-4">
              <p className="mb-2 text-xs text-slate-500">Browsing all products. Narrow it down:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {BROWSE_SUGGESTIONS.map((value) => (
                  <button
                    key={value}
                    type="button"
                    className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
                    onClick={() => {
                      setKeyword(value);
                      runSearch(value);
                    }}
                  >
                    {value}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {aiAlternates.length > 0 ? (
            <div className="mb-4 flex flex-wrap justify-center gap-2">
              {aiAlternates.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
                  onClick={() => {
                    setKeyword(value);
                    runSearch(value);
                  }}
                >
                  Try: {value}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mb-8 flex flex-wrap justify-center gap-2">
            {[
              "top discounts in CJ with 60% off",
              "most discounted shoes on Impact",
              "top discounts",
              "running shoes under $80"
            ].map((example) => (
              <button
                key={example}
                type="button"
                className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500"
                onClick={() => setAiQuery(example)}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
