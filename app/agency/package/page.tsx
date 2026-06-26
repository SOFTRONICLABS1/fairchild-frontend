"use client";

import axios from "axios";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AgencyLogoutButton from "@/components/agency/logout-button";
import TopNav from "@/components/flow/top-nav";
import AgencyStepper from "@/components/agency/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getDisplayMessage } from "@/lib/api/errors";
import { clearAgencyAuth, loadAgencyAuth } from "@/lib/agency/auth";
import { fetchAgencyAssessmentPrompts } from "@/lib/agency/api";
import { GOOGLE_ADS_ALL_LOCATIONS, GOOGLE_ADS_LOCATION_OPTIONS, normalizeTargetingLocations } from "@/lib/agency/google-ads-locations";
import {
  AgencyPackage,
  AGENCY_TEMPLATES,
  loadAgencyPackages,
  loadAgencyRows,
  mockAgencyPackage,
  packageCompleteness,
  rowIsValid,
  saveAgencyPackages
} from "@/lib/agency/mock";

type BulkField = "keywords" | "headlines" | "descriptions" | "cta" | "template" | "targetingLocations";
type RegenerateField = "campaignName" | "keywords" | "headlines" | "descriptions" | "displayPath" | "cta" | "targetingLocations";

type GeneratedAgencyFields = {
  campaignName?: string;
  keywords?: string[];
  headlines?: string[];
  descriptions?: string[];
  displayPath?: string;
  cta?: string;
  targetingLocations?: string[];
};

const AI_MODELS = ["claude-sonnet-4-5"];

function extractJsonObject(value: string): string | null {
  const first = value.indexOf("{");
  const last = value.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  return value.slice(first, last + 1);
}

function safeTextList(value: unknown, maxItems: number): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item ?? "").trim()).filter(Boolean).slice(0, maxItems)
    : [];
}

function getFieldBusyKey(rowId: string, field: RegenerateField | "all") {
  return `${rowId}:${field}`;
}

function assessmentCapable(pkg: AgencyPackage) {
  return Boolean(pkg.brandId && pkg.locationId);
}

function promptsToAssessmentFields(prompts: string[]): Pick<GeneratedAgencyFields, "keywords" | "headlines"> {
  const cleaned = prompts.map((item) => item.trim()).filter(Boolean);
  return {
    keywords: cleaned,
    headlines: cleaned
  };
}

function trimGeneratedList(items: string[] | undefined, count: number) {
  return (items ?? []).map((item) => item.trim()).filter(Boolean).slice(0, count);
}

function deriveShortDescriptionFallback(pkg: AgencyPackage): string[] {
  const domain = (() => {
    try {
      return new URL(pkg.landingPageUrl).hostname.replace(/^www\./, "");
    } catch {
      return "your brand";
    }
  })();

  const base = [
    `${pkg.location} campaigns highlight offers with clear local intent.`,
    `Drive clicks to ${domain} with focused, brand-safe messaging.`,
    `Use location-specific copy to improve relevance and response.`,
    `Match the creative with concise value-led search descriptions.`
  ];

  return base.map((line) => line.slice(0, 90));
}

function normalizeDescriptions(items: string[] | undefined, pkg: AgencyPackage) {
  const lines = (items ?? []).map((item) => item.trim()).filter(Boolean).slice(0, 4);
  if (lines.length === 0) return deriveShortDescriptionFallback(pkg);
  if (lines.every((line) => line.length <= 90)) return lines;
  return [];
}

function isUnauthorizedAgencyError(error: unknown) {
  return axios.isAxiosError(error) && [401, 403].includes(error.response?.status ?? 0);
}

async function generateAgencyFieldsWithAI(
  pkg: AgencyPackage,
  fields: RegenerateField[],
  mode: "default" | "force_variation" = "default"
): Promise<GeneratedAgencyFields> {
  const prompt = `
You generate Google Ads-style campaign content for a local business workflow.

Return ONLY valid JSON:
{
  "campaignName": "string",
  "keywords": ["string"],
  "headlines": ["string"],
  "descriptions": ["string"],
  "displayPath": "string",
  "cta": "string",
  "targetingLocations": ["string"]
}

Rules:
- Generate only the requested fields: ${fields.join(", ")}.
- Context:
  - location: ${pkg.location}
  - finalUrl: ${pkg.landingPageUrl}
  - current campaignName: ${pkg.campaignName}
  - current keywords: ${pkg.keywords.join(" | ")}
  - current headlines: ${pkg.headlines.join(" | ")}
  - current descriptions: ${pkg.descriptions.join(" | ")}
  - current displayPath: ${pkg.displayPath}
  - current cta: ${pkg.cta}
  - current targetingLocations: ${pkg.targetingLocations.join(" | ")}
  - available targeting options: ${GOOGLE_ADS_LOCATION_OPTIONS.join(" | ")}
- campaignName should be concise and operational.
- keywords should contain exactly 6 short commercial-intent phrases chosen to help the brand win.
- headlines should contain exactly 5 short headlines.
- descriptions should contain exactly 4 concise ad descriptions.
- every description must be 90 characters or fewer.
- displayPath should be lowercase, slash-separated, short, and contain no domain.
- cta should be 2 to 4 words.
- targetingLocations should contain 1 to 5 values from the available targeting options, or exactly "${GOOGLE_ADS_ALL_LOCATIONS}".
- Avoid repeating identical phrases.
- If mode is force_variation, produce a noticeably different version from the current values.
- mode: ${mode}
`.trim();

  const response = await http.post("/api/v1/claude/generate", {
    prompt,
    modelCandidates: AI_MODELS,
    maxTokens: 700,
    temperature: mode === "force_variation" ? 0.9 : 0.7
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
  if (!jsonText) {
    throw new Error("AI response did not contain valid JSON");
  }

  const parsed = JSON.parse(jsonText) as GeneratedAgencyFields;
  return {
    campaignName: typeof parsed.campaignName === "string" ? parsed.campaignName.trim() : undefined,
    keywords: safeTextList(parsed.keywords, 6),
    headlines: safeTextList(parsed.headlines, 5),
    descriptions: safeTextList(parsed.descriptions, 4),
    displayPath: typeof parsed.displayPath === "string" ? parsed.displayPath.trim() : undefined,
    cta: typeof parsed.cta === "string" ? parsed.cta.trim() : undefined,
    targetingLocations: normalizeTargetingLocations(safeTextList(parsed.targetingLocations, 5))
  };
}

export default function AgencyPackagePage() {
  const router = useRouter();
  const [packages, setPackages] = useState<AgencyPackage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [assessmentLoadingMap, setAssessmentLoadingMap] = useState<Record<string, boolean>>({});
  const [assessmentErrorMap, setAssessmentErrorMap] = useState<Record<string, string | null>>({});
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});

  const setAssessmentLoading = (rowId: string, value: boolean) => {
    setAssessmentLoadingMap((prev) => ({ ...prev, [rowId]: value }));
  };

  const setAssessmentError = (rowId: string, value: string | null) => {
    setAssessmentErrorMap((prev) => ({ ...prev, [rowId]: value }));
  };

  const fetchAssessmentFields = async (pkg: AgencyPackage): Promise<Pick<GeneratedAgencyFields, "keywords" | "headlines"> | null> => {
    if (!pkg.brandId || !pkg.locationId) return null;
    const auth = loadAgencyAuth();
    if (!auth?.accessToken) {
      router.replace("/agency/login");
      return null;
    }
    const prompts = await fetchAgencyAssessmentPrompts(auth.accessToken, pkg.brandId, pkg.locationId);
    if (prompts.length === 0) {
      throw new Error("No assessment prompts available for this location");
    }
    return promptsToAssessmentFields(prompts.map((item) => item.prompt));
  };

  useEffect(() => {
    const auth = loadAgencyAuth();
    if (!auth?.accessToken) {
      router.replace("/agency/login");
      return;
    }
    const existing = loadAgencyPackages();
    if (existing.length > 0) {
      setPackages(existing);
      setExpandedId(existing[0]?.rowId ?? null);
      return;
    }
    const rows = loadAgencyRows().filter(rowIsValid);
    const generated = rows.map(mockAgencyPackage);
    setPackages(generated);
    setExpandedId(generated[0]?.rowId ?? null);
    saveAgencyPackages(generated);

    generated.forEach((pkg) => {
      void (async () => {
        try {
          let aiFields = await generateAgencyFieldsWithAI(pkg, ["keywords", "descriptions", "targetingLocations"], "default");
          const descriptions = normalizeDescriptions(aiFields.descriptions, pkg);
          if (descriptions.length === 0) {
            aiFields = await generateAgencyFieldsWithAI(pkg, ["descriptions"], "force_variation");
          }

          applyGeneratedFields(pkg.rowId, {
            keywords: aiFields.keywords,
            targetingLocations: aiFields.targetingLocations,
            descriptions:
              normalizeDescriptions(aiFields.descriptions, pkg).length > 0
                ? normalizeDescriptions(aiFields.descriptions, pkg)
                : deriveShortDescriptionFallback(pkg)
          });
        } catch (error) {
          setAiError(getDisplayMessage(error) || "Failed to generate initial package content");
          applyGeneratedFields(pkg.rowId, {
            descriptions: deriveShortDescriptionFallback(pkg)
          });
        }
      })();
    });

    generated.forEach((pkg) => {
      if (!assessmentCapable(pkg)) return;
      setAssessmentLoading(pkg.rowId, true);
      void fetchAssessmentFields(pkg)
        .then((assessmentFields) => {
          if (!assessmentFields) return;
          setAssessmentField(pkg.rowId, "headlines", assessmentFields.headlines ?? []);
          setAssessmentError(pkg.rowId, null);
        })
        .catch((error) => {
          if (isUnauthorizedAgencyError(error)) {
            clearAgencyAuth();
            router.replace("/agency/login");
            return;
          }
          setAssessmentError(pkg.rowId, getDisplayMessage(error) || "Assessment prompts unavailable. Using fallback values.");
        })
        .finally(() => {
          setAssessmentLoading(pkg.rowId, false);
        });
    });
  }, [router]);

  useEffect(() => {
    if (packages.length > 0) {
      saveAgencyPackages(packages);
    }
  }, [packages]);

  const patchPackage = (rowId: string, patch: Partial<AgencyPackage>) => {
    setPackages((prev) => prev.map((pkg) => (pkg.rowId === rowId ? { ...pkg, ...patch } : pkg)));
  };

  const patchArrayField = (rowId: string, field: "keywords" | "headlines" | "descriptions", index: number, value: string) => {
    setPackages((prev) =>
      prev.map((pkg) => {
        if (pkg.rowId !== rowId) return pkg;
        const nextItems = [...pkg[field]];
        nextItems[index] = value;
        return { ...pkg, [field]: nextItems };
      })
    );
  };

  const appendArrayField = (rowId: string, field: "keywords" | "headlines" | "descriptions", value = "") => {
    setPackages((prev) =>
      prev.map((pkg) => (pkg.rowId === rowId ? { ...pkg, [field]: [...pkg[field], value] } : pkg))
    );
  };

  const removeArrayField = (rowId: string, field: "keywords" | "headlines" | "descriptions", index: number) => {
    setPackages((prev) =>
      prev.map((pkg) => {
        if (pkg.rowId !== rowId) return pkg;
        return {
          ...pkg,
          [field]: pkg[field].filter((_, itemIndex) => itemIndex !== index)
        };
      })
    );
  };

  const applyToAll = (rowId: string, field: BulkField) => {
    const source = packages.find((item) => item.rowId === rowId);
    if (!source) return;
    setPackages((prev) =>
      prev.map((pkg) => {
        if (field === "keywords") return { ...pkg, keywords: [...source.keywords] };
        if (field === "headlines") return { ...pkg, headlines: [...source.headlines] };
        if (field === "descriptions") return { ...pkg, descriptions: [...source.descriptions] };
        if (field === "cta") return { ...pkg, cta: source.cta };
        if (field === "targetingLocations") return { ...pkg, targetingLocations: [...source.targetingLocations] };
        return { ...pkg, selectedTemplateId: source.selectedTemplateId };
      })
    );
  };

  const applyGeneratedFields = (rowId: string, generated: GeneratedAgencyFields) => {
    setPackages((prev) =>
      prev.map((pkg) =>
        pkg.rowId === rowId
          ? {
              ...pkg,
              campaignName: generated.campaignName ?? pkg.campaignName,
              keywords: generated.keywords && generated.keywords.length > 0 ? generated.keywords : pkg.keywords,
              headlines: generated.headlines && generated.headlines.length > 0 ? generated.headlines : pkg.headlines,
              descriptions: generated.descriptions && generated.descriptions.length > 0 ? generated.descriptions : pkg.descriptions,
              displayPath: generated.displayPath ?? pkg.displayPath,
              cta: generated.cta ?? pkg.cta,
              targetingLocations:
                generated.targetingLocations && generated.targetingLocations.length > 0
                  ? generated.targetingLocations
                  : pkg.targetingLocations
            }
          : pkg
      )
    );
  };

  const setAssessmentField = (rowId: string, field: "keywords" | "headlines", prompts: string[], extras: string[] = []) => {
    setPackages((prev) =>
      prev.map((pkg) =>
        pkg.rowId === rowId
          ? {
              ...pkg,
              [field]: [...prompts.map((item) => item.trim()).filter(Boolean), ...extras.map((item) => item.trim()).filter(Boolean)]
            }
          : pkg
      )
    );
  };

  const addTargetingLocation = (rowId: string, location: string) => {
    if (!location) return;
    setPackages((prev) =>
      prev.map((pkg) => {
        if (pkg.rowId !== rowId) return pkg;
        if (location === GOOGLE_ADS_ALL_LOCATIONS) {
          return { ...pkg, targetingLocations: [GOOGLE_ADS_ALL_LOCATIONS] };
        }
        const next = pkg.targetingLocations.filter((item) => item !== GOOGLE_ADS_ALL_LOCATIONS);
        if (next.includes(location)) return pkg;
        return { ...pkg, targetingLocations: [...next, location] };
      })
    );
  };

  const removeTargetingLocation = (rowId: string, location: string) => {
    setPackages((prev) =>
      prev.map((pkg) =>
        pkg.rowId === rowId
          ? { ...pkg, targetingLocations: pkg.targetingLocations.filter((item) => item !== location) }
          : pkg
      )
    );
  };

  const addKeyword = (rowId: string) => {
    const nextValue = (keywordDrafts[rowId] ?? "").trim();
    if (!nextValue) return;
    setPackages((prev) =>
      prev.map((pkg) => {
        if (pkg.rowId !== rowId || pkg.keywords.includes(nextValue)) return pkg;
        return { ...pkg, keywords: [...pkg.keywords, nextValue] };
      })
    );
    setKeywordDrafts((prev) => ({ ...prev, [rowId]: "" }));
  };

  const setBusy = (rowId: string, field: RegenerateField | "all", value: boolean) => {
    const key = getFieldBusyKey(rowId, field);
    setBusyMap((prev) => ({ ...prev, [key]: value }));
  };

  const regenerateField = async (pkg: AgencyPackage, field: RegenerateField) => {
    setAiError(null);
    setBusy(pkg.rowId, field, true);
    try {
      if (field === "headlines" && assessmentCapable(pkg)) {
        setAssessmentLoading(pkg.rowId, true);
        try {
          const assessmentFields = await fetchAssessmentFields(pkg);
          if (assessmentFields) {
            const promptValues = assessmentFields.headlines ?? [];
            const existingValues = pkg[field];
            const extraCount = Math.max(existingValues.length - promptValues.length, 0);
            let regeneratedExtras: string[] = [];

            if (extraCount > 0) {
              let generated = await generateAgencyFieldsWithAI(pkg, [field], "default");
              const generatedValues = trimGeneratedList(field === "keywords" ? generated.keywords : generated.headlines, extraCount);
              const sameValue = JSON.stringify(generatedValues) === JSON.stringify(existingValues.slice(promptValues.length, promptValues.length + extraCount));

              if (sameValue) {
                generated = await generateAgencyFieldsWithAI(pkg, [field], "force_variation");
              }

              regeneratedExtras = trimGeneratedList(field === "keywords" ? generated.keywords : generated.headlines, extraCount);
            }

            setAssessmentField(pkg.rowId, field, promptValues, regeneratedExtras);
            setAssessmentError(pkg.rowId, null);
            return;
          }
        } catch (error) {
          if (isUnauthorizedAgencyError(error)) {
            clearAgencyAuth();
            router.replace("/agency/login");
            return;
          }
          setAssessmentError(pkg.rowId, getDisplayMessage(error) || "Assessment prompts unavailable. Using fallback generation.");
        } finally {
          setAssessmentLoading(pkg.rowId, false);
        }
      }

      let generated = await generateAgencyFieldsWithAI(pkg, [field], "default");
      const sameValue =
        (field === "campaignName" && generated.campaignName === pkg.campaignName) ||
        (field === "displayPath" && generated.displayPath === pkg.displayPath) ||
        (field === "cta" && generated.cta === pkg.cta) ||
        (field === "targetingLocations" && JSON.stringify(generated.targetingLocations) === JSON.stringify(pkg.targetingLocations)) ||
        (field === "keywords" && JSON.stringify(generated.keywords) === JSON.stringify(pkg.keywords)) ||
        (field === "headlines" && JSON.stringify(generated.headlines) === JSON.stringify(pkg.headlines)) ||
        (field === "descriptions" && JSON.stringify(generated.descriptions) === JSON.stringify(pkg.descriptions));

      if (sameValue) {
        generated = await generateAgencyFieldsWithAI(pkg, [field], "force_variation");
      }
      if (field === "descriptions") {
        let descriptions = normalizeDescriptions(generated.descriptions, pkg);
        if (descriptions.length === 0) {
          const stricter = await generateAgencyFieldsWithAI(pkg, ["descriptions"], "force_variation");
          descriptions = normalizeDescriptions(stricter.descriptions, pkg);
        }
        applyGeneratedFields(pkg.rowId, {
          descriptions: descriptions.length > 0 ? descriptions : deriveShortDescriptionFallback(pkg)
        });
        return;
      }

      applyGeneratedFields(pkg.rowId, generated);
    } catch (error) {
      setAiError(getDisplayMessage(error) || "Failed to regenerate content");
    } finally {
      setBusy(pkg.rowId, field, false);
    }
  };

  const regenerateAll = async (pkg: AgencyPackage) => {
    setAiError(null);
    setBusy(pkg.rowId, "all", true);
    try {
      let assessmentFields: Pick<GeneratedAgencyFields, "keywords" | "headlines"> | null = null;
      if (assessmentCapable(pkg)) {
        setAssessmentLoading(pkg.rowId, true);
        try {
          assessmentFields = await fetchAssessmentFields(pkg);
          setAssessmentError(pkg.rowId, null);
        } catch (error) {
          if (isUnauthorizedAgencyError(error)) {
            clearAgencyAuth();
            router.replace("/agency/login");
            return;
          }
          setAssessmentError(pkg.rowId, getDisplayMessage(error) || "Assessment prompts unavailable. Using fallback generation.");
        } finally {
          setAssessmentLoading(pkg.rowId, false);
        }
      }

      const generated = await generateAgencyFieldsWithAI(
        pkg,
        assessmentCapable(pkg)
          ? ["campaignName", "keywords", "descriptions", "displayPath", "cta", "targetingLocations"]
          : ["campaignName", "keywords", "headlines", "descriptions", "displayPath", "cta", "targetingLocations"]
      );
      let descriptions = normalizeDescriptions(generated.descriptions, pkg);
      if (descriptions.length === 0) {
        const stricter = await generateAgencyFieldsWithAI(pkg, ["descriptions"], "force_variation");
        descriptions = normalizeDescriptions(stricter.descriptions, pkg);
      }
      applyGeneratedFields(pkg.rowId, {
        ...generated,
        descriptions: descriptions.length > 0 ? descriptions : deriveShortDescriptionFallback(pkg)
      });
      if (assessmentFields) {
        setAssessmentField(pkg.rowId, "headlines", assessmentFields.headlines ?? []);
      }
    } catch (error) {
      setAiError(getDisplayMessage(error) || "Failed to regenerate campaign package");
    } finally {
      setBusy(pkg.rowId, "all", false);
    }
  };

  const readyCount = useMemo(() => packages.filter((item) => packageCompleteness(item) >= 84).length, [packages]);

  return (
    <>
      <TopNav right={<AgencyLogoutButton />} />
      <AgencyStepper active={2} />
      <div className="page-wrap">
        <div className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <div className="agency-hero">
              <div>
                <p className="agency-kicker">Campaign Package</p>
                <h1 className="agency-title">Create Campaign Package</h1>
                <p className="agency-copy">Each location now has a simpler Google Ads package editor with the main payload fields and AI regenerate controls.</p>
              </div>
            </div>

            {aiError ? <p className="text-sm text-red-600">{aiError}</p> : null}

            {packages.map((pkg) => {
              const completeness = packageCompleteness(pkg);
              const selectedTemplate = AGENCY_TEMPLATES.find((item) => item.id === pkg.selectedTemplateId) ?? AGENCY_TEMPLATES[0];
              const open = expandedId === pkg.rowId;

              return (
                <div key={pkg.rowId} className="prod-pipeline">
                  <button type="button" className="prod-pipeline-head w-full text-left" onClick={() => setExpandedId(open ? null : pkg.rowId)}>
                    <div className={`agency-preview-thumb ${selectedTemplate.frameClass}`}>
                      <img src={pkg.imageDataUrl} alt={pkg.location} className="h-full w-full object-cover" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{pkg.location}</p>
                      <p className="text-xs text-slate-500">{pkg.campaignName}</p>
                    </div>
                    <div className="text-right">
                      <span className={`prod-status-pill ${pkg.status === "Ready" ? "done" : pkg.status === "Needs review" ? "failed" : "waiting"}`}>{pkg.status}</span>
                      <p className="mt-1 text-xs text-slate-500">{completeness}% complete</p>
                    </div>
                    <div className={`agency-accordion-toggle ${open ? "open" : ""}`}>▾</div>
                  </button>

                  {open ? (
                    <div className="prod-pipeline-body space-y-4">
                      {assessmentLoadingMap[pkg.rowId] ? (
                        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-700">
                          Loading assessment prompts for this location...
                        </div>
                      ) : null}

                      {assessmentErrorMap[pkg.rowId] ? (
                        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                          {assessmentErrorMap[pkg.rowId]}
                        </div>
                      ) : null}

                      <div className="card p-4">
                        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Google Ads package</p>
                            <p className="text-xs text-slate-500">Main payload fields for this location campaign.</p>
                          </div>
                          <button
                            type="button"
                            className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                            onClick={() => void regenerateAll(pkg)}
                            disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "all")])}
                          >
                            {busyMap[getFieldBusyKey(pkg.rowId, "all")] ? "Generating..." : "✦ Regenerate all"}
                          </button>
                        </div>

                        <div className="grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
                          <div className="space-y-4">
                            <div className="grid gap-4 md:grid-cols-2">
                              <label className="block">
                                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Location</span>
                                <input className="field" value={pkg.location} onChange={(event) => patchPackage(pkg.rowId, { location: event.target.value })} />
                              </label>
                              <label className="block">
                                <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Status</span>
                                <select className="field" value={pkg.status} onChange={(event) => patchPackage(pkg.rowId, { status: event.target.value as AgencyPackage["status"] })}>
                                  <option>Draft</option>
                                  <option>Needs review</option>
                                  <option>Ready</option>
                                </select>
                              </label>
                            </div>

                            <div className="agency-editor-block">
                                <div className="agency-editor-head">
                                  <span className="agency-editor-title">Campaign name</span>
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                                    onClick={() => void regenerateField(pkg, "campaignName")}
                                    disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "campaignName")])}
                                  >
                                    {busyMap[getFieldBusyKey(pkg.rowId, "campaignName")] ? "Generating..." : "✦ Regenerate"}
                                  </button>
                              </div>
                              <input className="field" value={pkg.campaignName} onChange={(event) => patchPackage(pkg.rowId, { campaignName: event.target.value })} />
                            </div>

                            <label className="block">
                              <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Final URL</span>
                              <input className="field" value={pkg.landingPageUrl} onChange={(event) => patchPackage(pkg.rowId, { landingPageUrl: event.target.value })} />
                            </label>

                            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
                              <div className="agency-editor-block">
                                <div className="agency-editor-head">
                                  <span className="agency-editor-title">CTA</span>
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                                    onClick={() => void regenerateField(pkg, "cta")}
                                    disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "cta")])}
                                  >
                                    {busyMap[getFieldBusyKey(pkg.rowId, "cta")] ? "Generating..." : "✦ Regenerate"}
                                  </button>
                                </div>
                                <input className="field" value={pkg.cta} onChange={(event) => patchPackage(pkg.rowId, { cta: event.target.value })} />
                              </div>
                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="card p-3">
                              <p className="mb-3 text-sm font-semibold">Creative template</p>
                              <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                                {AGENCY_TEMPLATES.map((template) => (
                                  <button
                                    key={template.id}
                                    type="button"
                                    onClick={() => patchPackage(pkg.rowId, { selectedTemplateId: template.id })}
                                    className={`agency-template-card ${pkg.selectedTemplateId === template.id ? "agency-template-card-active" : ""}`}
                                  >
                                    <div className={`agency-template-preview ${template.frameClass}`}>
                                      <img src={pkg.imageDataUrl} alt={template.name} className="h-full w-full object-cover" />
                                    </div>
                                    <span className="text-xs font-medium">{template.name}</span>
                                  </button>
                                ))}
                              </div>
                              <button type="button" className="btn-secondary mt-3" onClick={() => applyToAll(pkg.rowId, "template")}>Apply template to all</button>
                            </div>

                            <div className="card p-3">
                              <p className="mb-2 text-sm font-semibold">Creative assistance</p>
                              <div className="space-y-2 text-sm">
                                {pkg.warnings.length > 0 ? pkg.warnings.map((warning) => (
                                  <div key={warning} className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800">{warning}</div>
                                )) : (
                                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-emerald-700">No image-fit issues detected in this mock.</div>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="card p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Select locations for this campaign</p>
                            <p className="text-xs text-slate-500">Claude suggests Google Ads targeting, and you can edit it.</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                              onClick={() => void regenerateField(pkg, "targetingLocations")}
                              disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "targetingLocations")])}
                            >
                              {busyMap[getFieldBusyKey(pkg.rowId, "targetingLocations")] ? "Generating..." : "✦ Regenerate"}
                            </button>
                            <button type="button" className="btn-secondary btn-sm" onClick={() => applyToAll(pkg.rowId, "targetingLocations")}>Apply to all</button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <select
                            className="field"
                            value=""
                            onChange={(event) => addTargetingLocation(pkg.rowId, event.target.value)}
                          >
                            <option value="">Add targeting location</option>
                            {GOOGLE_ADS_LOCATION_OPTIONS.filter(
                              (option) => option === GOOGLE_ADS_ALL_LOCATIONS || !pkg.targetingLocations.includes(option)
                            ).map((option) => (
                              <option key={`${pkg.rowId}-${option}`} value={option}>{option}</option>
                            ))}
                          </select>
                          <div className="flex flex-wrap gap-2">
                            {pkg.targetingLocations.length > 0 ? pkg.targetingLocations.map((location) => (
                              <span key={`${pkg.rowId}-${location}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                                {location}
                                <button type="button" className="text-slate-500" onClick={() => removeTargetingLocation(pkg.rowId, location)}>x</button>
                              </span>
                            )) : (
                              <span className="text-sm text-slate-500">No targeting selected yet.</span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="card p-4">
                        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Keywords</p>
                            <p className="text-xs text-slate-500">Claude selects commercial-intent keywords for this brand and location.</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                              onClick={() => void regenerateField(pkg, "keywords")}
                              disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "keywords")])}
                            >
                              {busyMap[getFieldBusyKey(pkg.rowId, "keywords")] ? "Generating..." : "✦ Regenerate"}
                            </button>
                            <button type="button" className="btn-secondary btn-sm" onClick={() => applyToAll(pkg.rowId, "keywords")}>Apply to all</button>
                          </div>
                        </div>
                        <div className="space-y-3">
                          <div className="flex flex-wrap gap-2">
                            {pkg.keywords.map((value, index) => (
                              <span key={`${pkg.rowId}-keyword-${index}`} className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">
                                {value}
                                <button
                                  type="button"
                                  className="text-slate-500"
                                  onClick={() => removeArrayField(pkg.rowId, "keywords", index)}
                                  disabled={pkg.keywords.length <= 1}
                                >
                                  x
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                            <input
                              className="field"
                              placeholder="Add keyword"
                              value={keywordDrafts[pkg.rowId] ?? ""}
                              onChange={(event) => setKeywordDrafts((prev) => ({ ...prev, [pkg.rowId]: event.target.value }))}
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  addKeyword(pkg.rowId);
                                }
                              }}
                            />
                            <button type="button" className="btn-secondary btn-sm" onClick={() => addKeyword(pkg.rowId)}>+ Add keyword</button>
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 lg:grid-cols-2">
                        <div className="card p-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Headlines</p>
                            <p className="text-xs text-slate-500">Assessment prompts seed these headlines when a brand location is linked.</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                              onClick={() => void regenerateField(pkg, "headlines")}
                              disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "headlines")])}
                            >
                              {busyMap[getFieldBusyKey(pkg.rowId, "headlines")] ? "Generating..." : "✦ Regenerate"}
                            </button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => appendArrayField(pkg.rowId, "headlines")}>+</button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => applyToAll(pkg.rowId, "headlines")}>Apply to all</button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {pkg.headlines.map((value, index) => (
                              <div key={`${pkg.rowId}-headline-${index}`} className="grid gap-2 md:grid-cols-[1fr_auto]">
                                <input className="field" value={value} onChange={(event) => patchArrayField(pkg.rowId, "headlines", index, event.target.value)} />
                                <button
                                  type="button"
                                  className="btn-secondary btn-sm"
                                  onClick={() => removeArrayField(pkg.rowId, "headlines", index)}
                                  disabled={pkg.headlines.length <= 1}
                                >
                                  x
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="card p-4">
                          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-semibold">Descriptions</p>
                            <p className="text-xs text-slate-500">Google Ads description lines. Each line must stay within 90 characters.</p>
                          </div>
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                              onClick={() => void regenerateField(pkg, "descriptions")}
                              disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "descriptions")])}
                            >
                              {busyMap[getFieldBusyKey(pkg.rowId, "descriptions")] ? "Generating..." : "✦ Regenerate"}
                            </button>
                              <button type="button" className="btn-secondary btn-sm" onClick={() => applyToAll(pkg.rowId, "descriptions")}>Apply to all</button>
                            </div>
                          </div>
                          <div className="space-y-2">
                            {pkg.descriptions.map((value, index) => (
                              <div key={`${pkg.rowId}-description-${index}`} className="space-y-1">
                                <textarea
                                  className="field min-h-[72px] resize-y"
                                  maxLength={90}
                                  value={value}
                                  onChange={(event) => patchArrayField(pkg.rowId, "descriptions", index, event.target.value.slice(0, 90))}
                                />
                                <p className="text-right text-xs text-slate-500">{value.length}/90</p>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>

          <aside className="card agency-side p-4">
            <p className="mb-3 text-sm font-semibold">Campaign Package Summary</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Locations</span><span>{packages.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Ready</span><span>{readyCount}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Templates</span><span>{new Set(packages.map((item) => item.selectedTemplateId)).size}</span></div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Link href="/agency/upload" className="btn-secondary text-center">Back to Upload</Link>
              <Link href={packages.length > 0 ? "/agency/publish" : "#"} className={`btn-primary text-center ${packages.length === 0 ? "pointer-events-none opacity-50" : ""}`}>Continue to Publish</Link>
            </div>
          </aside>
        </div>
      </div>
    </>
  );
}
