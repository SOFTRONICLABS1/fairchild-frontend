"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";

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

export default function SearchPage() {
  const router = useRouter();
  const [cj, setCj] = useState(true);
  const [impact, setImpact] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [aiQuery, setAiQuery] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiAlternates, setAiAlternates] = useState<string[]>([]);

  const comingSoon = () => {
    window.alert("Coming soon");
  };

  const runSearch = () => {
    const trimmed = keyword.trim();
    const useCj = cj || (!cj && !impact);
    const useImpact = impact || (!cj && !impact);
    const params = new URLSearchParams({
      q: trimmed,
      cj: useCj ? "1" : "0",
      impact: useImpact ? "1" : "0"
    });
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
      const badKeywords = new Set([
        "discounted products",
        "best products",
        "top products",
        "offers",
        "best offer",
        "product deals"
      ]);
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
      } else if (platform === "both") {
        useCj = true;
        useImpact = true;
      } else if (platform === "current") {
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
      router.push(`/results?${params.toString()}`);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "AI search failed");
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

          <div className="mb-5 grid grid-cols-2 gap-3">
            <PlatformCard active={cj} code="CJ" title="CJ Affiliate" subtitle="Commission Junction" tone="cj" onClick={() => setCj((v) => !v)} />
            <PlatformCard active={impact} code="IM" title="Impact" subtitle="Impact.com partnerships" tone="imp" onClick={() => setImpact((v) => !v)} />
          </div>

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
          </div>

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
            <button
              type="button"
              onClick={() => void runAiSearch()}
              disabled={aiLoading}
              className="rounded-md bg-gradient-to-r from-[#185FA5] to-[#6366F1] px-3 py-2 text-xs font-medium text-white"
            >
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

          {/* Stats block hidden for now */}
        </div>
      </div>
    </>
  );
}
