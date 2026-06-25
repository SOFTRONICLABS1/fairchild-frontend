"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getDisplayMessage } from "@/lib/api/errors";

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
  const [keywordHelpOpen, setKeywordHelpOpen] = useState(false);
  const [keywordError, setKeywordError] = useState<string | null>(null);
  const [cjAdvertisers, setCjAdvertisers] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCjAdvertiserId, setSelectedCjAdvertiserId] = useState("");
  const [cjAdvertisersLoading, setCjAdvertisersLoading] = useState(false);
  const [cjAdvertisersError, setCjAdvertisersError] = useState<string | null>(null);
  const [impactCampaignOptions, setImpactCampaignOptions] = useState<Array<{ campaignName: string; catalogIds: string[] }>>([]);
  const [selectedImpactCampaign, setSelectedImpactCampaign] = useState("");
  const [impactCampaignLoading, setImpactCampaignLoading] = useState(false);
  const [impactCampaignError, setImpactCampaignError] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("search:cj-advertiser-id");
    if (saved !== null) setSelectedCjAdvertiserId(saved);
    const savedImpactCampaign = sessionStorage.getItem("search:impact-campaign");
    if (savedImpactCampaign !== null) setSelectedImpactCampaign(savedImpactCampaign);
  }, []);

  useEffect(() => {
    sessionStorage.setItem("search:cj-advertiser-id", selectedCjAdvertiserId);
  }, [selectedCjAdvertiserId]);

  useEffect(() => {
    sessionStorage.setItem("search:impact-campaign", selectedImpactCampaign);
  }, [selectedImpactCampaign]);

  useEffect(() => {
    const loadAdvertisers = async () => {
      if (!cj || cjAdvertisers.length > 0 || cjAdvertisersLoading) return;
      setCjAdvertisersLoading(true);
      setCjAdvertisersError(null);
      try {
        const response = await http.get("/api/v1/cj/advertisers/lookup", {
          params: {
            "requestor-cid": "6947255",
            "advertiser-ids": "joined",
            "response-format": "json"
          }
        });
        const data = unwrapEnvelope<{
          "cj-api"?: {
            advertisers?: {
              advertiser?: Array<{ "advertiser-id"?: string; "advertiser-name"?: string }> | { "advertiser-id"?: string; "advertiser-name"?: string };
            };
          };
        }>(response.data);
        const rawAdvertisers = data?.["cj-api"]?.advertisers?.advertiser;
        const list = Array.isArray(rawAdvertisers) ? rawAdvertisers : rawAdvertisers ? [rawAdvertisers] : [];
        const normalized = list
          .map((item) => ({
            id: String(item["advertiser-id"] ?? "").trim(),
            name: String(item["advertiser-name"] ?? "").trim()
          }))
          .filter((item) => item.id && item.name);
        setCjAdvertisers(normalized);
      } catch (error) {
        setCjAdvertisersError(getDisplayMessage(error) || "Failed to load CJ advertisers");
      } finally {
        setCjAdvertisersLoading(false);
      }
    };
    void loadAdvertisers();
  }, [cj, cjAdvertisers.length, cjAdvertisersLoading]);

  useEffect(() => {
    const loadImpactCampaigns = async () => {
      if (!impact || impactCampaignOptions.length > 0 || impactCampaignLoading) return;
      setImpactCampaignLoading(true);
      setImpactCampaignError(null);
      try {
        const limit = 20;
        let offset = 0;
        const campaignMap = new Map<string, Set<string>>();
        while (true) {
          const response = await http.get("/api/v1/impact/catalogs", {
            params: { limit, offset }
          });
          const data = unwrapEnvelope<{ Catalogs?: Array<{ Id?: string; CampaignName?: string }> }>(response.data);
          const catalogs = Array.isArray(data.Catalogs) ? data.Catalogs : [];
          catalogs.forEach((catalog) => {
            const campaignName = String(catalog.CampaignName ?? "").trim();
            const catalogId = String(catalog.Id ?? "").trim();
            if (!campaignName || !catalogId) return;
            if (!campaignMap.has(campaignName)) {
              campaignMap.set(campaignName, new Set());
            }
            campaignMap.get(campaignName)?.add(catalogId);
          });
          if (catalogs.length < limit) break;
          offset += limit;
        }

        const options = Array.from(campaignMap.entries())
          .map(([campaignName, catalogIds]) => ({
            campaignName,
            catalogIds: Array.from(catalogIds)
          }))
          .sort((a, b) => a.campaignName.localeCompare(b.campaignName));
        setImpactCampaignOptions(options);
        sessionStorage.setItem(
          "search:impact-campaign-map",
          JSON.stringify(
            options.reduce<Record<string, string[]>>((acc, item) => {
              acc[item.campaignName] = item.catalogIds;
              return acc;
            }, {})
          )
        );
      } catch (error) {
        setImpactCampaignError(getDisplayMessage(error) || "Failed to load Impact campaigns");
      } finally {
        setImpactCampaignLoading(false);
      }
    };
    void loadImpactCampaigns();
  }, [impact, impactCampaignLoading, impactCampaignOptions.length]);

  const comingSoon = () => {
    window.alert("Coming soon");
  };

  const runSearch = () => {
    const trimmed = keyword.trim();
    if (/^(https?:\/\/|www\.)/i.test(trimmed)) {
      setKeywordError("Enter a related keyword. Example: 'Nike shoes'. Product URLs are not supported for keyword search.");
      return;
    }
    setKeywordError(null);
    const effectiveKeyword = trimmed || "all products";
    const useCj = cj || (!cj && !impact);
    const useImpact = impact || (!cj && !impact);
    const params = new URLSearchParams({
      q: effectiveKeyword,
      cj: useCj ? "1" : "0",
      impact: useImpact ? "1" : "0"
    });
    if (useCj && selectedCjAdvertiserId) {
      params.set("cjAdvertiserId", selectedCjAdvertiserId);
    }
    if (useImpact && selectedImpactCampaign) {
      params.set("impactCampaign", selectedImpactCampaign);
    }
    router.push(`/results?${params.toString()}`);
  };

  const extractJsonObject = (value: string): string | null => {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) return null;
    return value.slice(first, last + 1);
  };

  const runAiSearch = async () => {
    const promptInput = aiQuery.trim();
    if (!promptInput) return;

    setAiLoading(true);
    setAiError(null);
    try {
      const contextPrompt = `
You are a query parser for affiliate product search.
Convert user request into strict JSON for frontend use.

Return ONLY valid JSON, no explanation:
{
  "keyword": "string",
  "alternateKeywords": ["string", "string"],
  "platform": "cj" | "impact" | "both" | "current"
}

Rules:
- "keyword" must be a SHORT product-like search term (1 to 3 words max).
- "alternateKeywords" should contain up to 3 extra short keyword candidates (1 to 3 words each).
- "alternateKeywords" should be different from "keyword".
- keyword should look like what users type in catalog search (product type/brand/model).
- avoid generic terms like: "best products", "discounted products", "top products", "offers".
- prefer concrete nouns such as shoes, earbuds, mouse, keyboard, cat bites, dog food, sunglasses.
- keep keyword lowercase except brand/model names.
- If user explicitly asks CJ only => platform "cj".
- If user explicitly asks Impact only => platform "impact".
- If user asks both or all => platform "both".
- If platform is not specified => platform "current".
- Never return markdown.

User request: ${promptInput}
`.trim();

      const response = await http.post("/api/v1/claude/generate", {
        prompt: contextPrompt,
        modelCandidates: ["claude-sonnet-4-5"],
        maxTokens: 500,
        temperature: 0.7
      });

      const data = unwrapEnvelope<unknown>(response.data);
      let rawText = "";

      if (typeof data === "string") {
        rawText = data;
      } else if (data && typeof data === "object") {
        const candidate =
          (data as Record<string, unknown>).text ??
          (data as Record<string, unknown>).output ??
          (data as Record<string, unknown>).content ??
          (data as Record<string, unknown>).response;
        rawText = typeof candidate === "string" ? candidate : JSON.stringify(candidate ?? data);
      }

      const jsonText = extractJsonObject(rawText);
      if (!jsonText) throw new Error("AI response did not contain valid JSON");
      const parsed = JSON.parse(jsonText) as { keyword?: string; alternateKeywords?: string[]; platform?: string };

      const normalizedKeyword = (parsed.keyword ?? "")
        .trim()
        .replace(/\s+/g, " ")
        .split(" ")
        .slice(0, 3)
        .join(" ");
      const badKeywords = new Set(["discounted products", "best products", "top products", "offers", "best offer", "product deals"]);
      let nextKeyword = badKeywords.has(normalizedKeyword.toLowerCase()) ? "" : normalizedKeyword;
      if (!nextKeyword) {
        const fallback = promptInput
          .toLowerCase()
          .replace(/[^a-z0-9\s]/g, " ")
          .replace(/\s+/g, " ")
          .trim()
          .split(" ")
          .filter((word) => !["most", "best", "top", "discounted", "products", "product", "in", "for", "the", "and", "with", "on"].includes(word))
          .slice(0, 3)
          .join(" ");
        nextKeyword = fallback || "shoes";
      }
      if (!nextKeyword) throw new Error("AI could not generate a keyword");

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

      const platform = (parsed.platform ?? "current").toLowerCase();
      let useCj = cj;
      let useImpact = impact;
      if (platform === "cj") {
        useCj = true;
        useImpact = false;
      } else if (platform === "impact") {
        useCj = false;
        useImpact = true;
      } else if (platform === "both" || platform === "current") {
        useCj = true;
        useImpact = true;
      }

      if (!useCj && !useImpact) {
        useCj = true;
        useImpact = true;
      }

      setKeyword(nextKeyword);
      setCj(useCj);
      setImpact(useImpact);
      setAiAlternates(alternates);

      const params = new URLSearchParams({
        q: nextKeyword,
        cj: useCj ? "1" : "0",
        impact: useImpact ? "1" : "0"
      });
      if (useCj && selectedCjAdvertiserId) {
        params.set("cjAdvertiserId", selectedCjAdvertiserId);
      }
      if (useImpact && selectedImpactCampaign) {
        params.set("impactCampaign", selectedImpactCampaign);
      }
      router.push(`/results?${params.toString()}`);
    } catch (error) {
      setAiError(getDisplayMessage(error) || "AI search failed");
      setAiAlternates([]);
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
            <div className="card mb-4 p-3 text-left">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">CJ Advertiser</label>
              <select className="field w-full" value={selectedCjAdvertiserId} onChange={(event) => setSelectedCjAdvertiserId(event.target.value)} disabled={cjAdvertisersLoading}>
                <option value="">All</option>
                {cjAdvertisers.map((advertiser) => (
                  <option key={advertiser.id} value={advertiser.id}>{advertiser.name}</option>
                ))}
              </select>
              {cjAdvertisersLoading ? <p className="mt-2 text-xs text-slate-500">Loading advertisers...</p> : null}
              {cjAdvertisersError ? <p className="mt-2 text-xs text-amber-700">{cjAdvertisersError}</p> : null}
            </div>
          ) : null}
          {impact ? (
            <div className="card mb-4 p-3 text-left">
              <label className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Impact Advertiser</label>
              <select className="field w-full" value={selectedImpactCampaign} onChange={(event) => setSelectedImpactCampaign(event.target.value)} disabled={impactCampaignLoading}>
                <option value="">All</option>
                {impactCampaignOptions.map((campaign) => (
                  <option key={campaign.campaignName} value={campaign.campaignName}>{campaign.campaignName}</option>
                ))}
              </select>
              {impactCampaignLoading ? <p className="mt-2 text-xs text-slate-500">Loading campaigns...</p> : null}
              {impactCampaignError ? <p className="mt-2 text-xs text-amber-700">{impactCampaignError}</p> : null}
            </div>
          ) : null}

          <div className="card mb-4 flex items-center gap-2 px-3 py-2">
            <span className="text-slate-400">⌕</span>
            <input
              className="w-full border-none bg-transparent text-sm outline-none"
              placeholder="Search products e.g. wireless headphones..."
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") runSearch();
              }}
            />
            <button type="button" onClick={runSearch} className="btn-primary">Search</button>
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
          {aiError ? <p className="mb-3 text-sm text-red-600">{aiError}</p> : null}
          {aiAlternates.length > 0 ? (
            <div className="mb-4 flex flex-wrap justify-center gap-2">
              {aiAlternates.map((value) => (
                <button
                  key={value}
                  type="button"
                  className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-600"
                  onClick={() => {
                    const useCj = cj || (!cj && !impact);
                    const useImpact = impact || (!cj && !impact);
                    const params = new URLSearchParams({
                      q: value,
                      cj: useCj ? "1" : "0",
                      impact: useImpact ? "1" : "0"
                    });
                    if (useCj && selectedCjAdvertiserId) {
                      params.set("cjAdvertiserId", selectedCjAdvertiserId);
                    }
                    if (useImpact && selectedImpactCampaign) {
                      params.set("impactCampaign", selectedImpactCampaign);
                    }
                    router.push(`/results?${params.toString()}`);
                  }}
                >
                  Try: {value}
                </button>
              ))}
            </div>
          ) : null}

          <div className="mb-8 flex flex-wrap justify-center gap-2">
            <button type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" onClick={() => setAiQuery("most discounted products in CJ")}>Most discounted in CJ</button>
            <button type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" onClick={() => setAiQuery("top rated electronics on Impact")}>Top electronics on Impact</button>
            <button type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" onClick={() => setAiQuery("best selling products")}>Best sellers</button>
            <button type="button" className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" onClick={() => setAiQuery("new arrivals this week")}>New arrivals</button>
          </div>
        </div>
      </div>
    </>
  );
}
