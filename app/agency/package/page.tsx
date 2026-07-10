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
import { getSocialPlatform, SOCIAL_PLATFORM_OPTIONS } from "@/lib/agency/social-platforms";
import {
  AgencyPackage,
  AgencyPackageMode,
  AGENCY_TEMPLATES,
  AgencyPackageView,
  loadAgencyPackages,
  loadAgencyRows,
  mockAgencyPackage,
  packageCompleteness,
  rowIsValid,
  SocialPlatformId,
  saveAgencyPackages
} from "@/lib/agency/mock";

type BulkField = "keywords" | "headlines" | "descriptions" | "cta" | "template" | "targetingLocations" | "socialPlatforms";
type RegenerateField =
  | "campaignName"
  | "keywords"
  | "headlines"
  | "descriptions"
  | "displayPath"
  | "cta"
  | "targetingLocations"
  | "socialPostTitle"
  | "socialCaption"
  | "socialCta";

type GeneratedAgencyFields = {
  campaignName?: string;
  keywords?: string[];
  headlines?: string[];
  descriptions?: string[];
  displayPath?: string;
  cta?: string;
  targetingLocations?: string[];
  socialPostTitle?: string;
  socialCaption?: string;
  socialCta?: string;
};

const AI_MODELS = ["claude-sonnet-4-5"];

function renderCreativePreview(pkg: AgencyPackage, className: string, compact = false) {
  if (pkg.assetType === "video") {
    return (
      <video
        src={pkg.assetDataUrl || pkg.imageDataUrl}
        className={className}
        controls={!compact}
        muted
        playsInline
        preload="metadata"
      />
    );
  }
  return <img src={pkg.assetDataUrl || pkg.imageDataUrl} alt={pkg.location} className={className} />;
}

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

function deriveSocialTitleFallback(pkg: AgencyPackage) {
  return `${pkg.location} • ${pkg.campaignName}`.slice(0, 90);
}

function deriveSocialCaptionFallback(pkg: AgencyPackage) {
  return [
    `Spotlight ${pkg.location} with fresh creative from ${deriveSocialTitleFallback(pkg)}.`,
    `Tap through to explore the offer and learn more at ${pkg.landingPageUrl}.`
  ].join(" ");
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
  "targetingLocations": ["string"],
  "socialPostTitle": "string",
  "socialCaption": "string",
  "socialCta": "string"
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
  - current socialPostTitle: ${pkg.socialPostTitle}
  - current socialCaption: ${pkg.socialCaption}
  - current socialCta: ${pkg.socialCta}
  - available targeting options: ${GOOGLE_ADS_LOCATION_OPTIONS.join(" | ")}
- campaignName should be concise and operational.
- keywords should contain exactly 6 short commercial-intent phrases chosen to help the brand win.
- headlines should contain exactly 5 short headlines.
- descriptions should contain exactly 4 concise ad descriptions.
- every description must be 90 characters or fewer.
- displayPath should be lowercase, slash-separated, short, and contain no domain.
- cta should be 2 to 4 words.
- targetingLocations should contain 1 to 5 values from the available targeting options, or exactly "${GOOGLE_ADS_ALL_LOCATIONS}".
- socialPostTitle should be concise and social-friendly.
- socialCaption should be 2 to 4 short sentences and under 280 characters.
- socialCta should be 2 to 4 words.
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
    targetingLocations: normalizeTargetingLocations(safeTextList(parsed.targetingLocations, 5)),
    socialPostTitle: typeof parsed.socialPostTitle === "string" ? parsed.socialPostTitle.trim() : undefined,
    socialCaption: typeof parsed.socialCaption === "string" ? parsed.socialCaption.trim() : undefined,
    socialCta: typeof parsed.socialCta === "string" ? parsed.socialCta.trim() : undefined
  };
}

export default function AgencyPackagePage() {
  const router = useRouter();
  const [packages, setPackages] = useState<AgencyPackage[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewVideoPkg, setPreviewVideoPkg] = useState<AgencyPackage | null>(null);
  const [packageViewMap, setPackageViewMap] = useState<Record<string, AgencyPackageView>>({});
  const [socialPreviewMap, setSocialPreviewMap] = useState<Record<string, SocialPlatformId>>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [busyMap, setBusyMap] = useState<Record<string, boolean>>({});
  const [assessmentLoadingMap, setAssessmentLoadingMap] = useState<Record<string, boolean>>({});
  const [assessmentErrorMap, setAssessmentErrorMap] = useState<Record<string, string | null>>({});
  const [keywordDrafts, setKeywordDrafts] = useState<Record<string, string>>({});
  const packageMode = packages[0]?.packageMode ?? "both";

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
      setPackageViewMap(Object.fromEntries(existing.map((item) => [item.rowId, "google" as AgencyPackageView])));
      setSocialPreviewMap(
        Object.fromEntries(
          existing.map((item) => [item.rowId, item.selectedSocialPlatforms[0] ?? "facebook"])
        )
      );
      return;
    }
    const rows = loadAgencyRows().filter(rowIsValid);
    const generated = rows.map(mockAgencyPackage);
    setPackages(generated);
    setExpandedId(generated[0]?.rowId ?? null);
    setPackageViewMap(Object.fromEntries(generated.map((item) => [item.rowId, "google" as AgencyPackageView])));
    setSocialPreviewMap(
      Object.fromEntries(
        generated.map((item) => [item.rowId, item.selectedSocialPlatforms[0] ?? "facebook"])
      )
    );
    saveAgencyPackages(generated);

    generated.forEach((pkg) => {
      void (async () => {
        try {
          let aiFields = await generateAgencyFieldsWithAI(
            pkg,
            ["keywords", "descriptions", "targetingLocations", "socialPostTitle", "socialCaption", "socialCta"],
            "default"
          );
          const descriptions = normalizeDescriptions(aiFields.descriptions, pkg);
          if (descriptions.length === 0) {
            aiFields = await generateAgencyFieldsWithAI(pkg, ["descriptions"], "force_variation");
          }

          applyGeneratedFields(pkg.rowId, {
            keywords: aiFields.keywords,
            targetingLocations: aiFields.targetingLocations,
            socialPostTitle: aiFields.socialPostTitle ?? deriveSocialTitleFallback(pkg),
            socialCaption: aiFields.socialCaption ?? deriveSocialCaptionFallback(pkg),
            socialCta: aiFields.socialCta ?? pkg.socialCta,
            descriptions:
              normalizeDescriptions(aiFields.descriptions, pkg).length > 0
                ? normalizeDescriptions(aiFields.descriptions, pkg)
                : deriveShortDescriptionFallback(pkg)
          });
        } catch (error) {
          setAiError(getDisplayMessage(error) || "Failed to generate initial package content");
          applyGeneratedFields(pkg.rowId, {
            descriptions: deriveShortDescriptionFallback(pkg),
            socialPostTitle: deriveSocialTitleFallback(pkg),
            socialCaption: deriveSocialCaptionFallback(pkg)
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

  const setPackageModeForAll = (mode: AgencyPackageMode) => {
    setPackages((prev) => prev.map((pkg) => ({ ...pkg, packageMode: mode })));
    setPackageViewMap((prev) =>
      Object.fromEntries(
        packages.map((pkg) => [
          pkg.rowId,
          mode === "google" ? "google" : mode === "social" ? "social" : prev[pkg.rowId] ?? "google"
        ])
      )
    );
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
        if (field === "socialPlatforms") return { ...pkg, selectedSocialPlatforms: [...source.selectedSocialPlatforms] };
        return { ...pkg, selectedTemplateId: source.selectedTemplateId };
      })
    );
    if (field === "socialPlatforms") {
      const previewPlatform = source.selectedSocialPlatforms[0] ?? "facebook";
      setSocialPreviewMap((prev) => Object.fromEntries(packages.map((pkg) => [pkg.rowId, previewPlatform])));
    }
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
              socialPostTitle: generated.socialPostTitle ?? pkg.socialPostTitle,
              socialCaption: generated.socialCaption ?? pkg.socialCaption,
              socialCta: generated.socialCta ?? pkg.socialCta,
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

  const toggleSocialPlatform = (rowId: string, platformId: SocialPlatformId) => {
    setPackages((prev) =>
      prev.map((pkg) => {
        if (pkg.rowId !== rowId) return pkg;
        const exists = pkg.selectedSocialPlatforms.includes(platformId);
        const next = exists
          ? pkg.selectedSocialPlatforms.filter((item) => item !== platformId)
          : [...pkg.selectedSocialPlatforms, platformId];
        return { ...pkg, selectedSocialPlatforms: next };
      })
    );
    setSocialPreviewMap((prev) => {
      const currentPreview = prev[rowId];
      if (currentPreview === platformId) {
        const nextPkg = packages.find((item) => item.rowId === rowId);
        const remaining = nextPkg?.selectedSocialPlatforms.filter((item) => item !== platformId) ?? [];
        return { ...prev, [rowId]: remaining[0] ?? "facebook" };
      }
      return { ...prev, [rowId]: currentPreview || platformId };
    });
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
              const generatedValues = trimGeneratedList(generated.headlines, extraCount);
              const sameValue = JSON.stringify(generatedValues) === JSON.stringify(existingValues.slice(promptValues.length, promptValues.length + extraCount));

              if (sameValue) {
                generated = await generateAgencyFieldsWithAI(pkg, [field], "force_variation");
              }

              regeneratedExtras = trimGeneratedList(generated.headlines, extraCount);
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
        (field === "descriptions" && JSON.stringify(generated.descriptions) === JSON.stringify(pkg.descriptions)) ||
        (field === "socialPostTitle" && generated.socialPostTitle === pkg.socialPostTitle) ||
        (field === "socialCaption" && generated.socialCaption === pkg.socialCaption) ||
        (field === "socialCta" && generated.socialCta === pkg.socialCta);

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
          ? ["campaignName", "keywords", "descriptions", "displayPath", "cta", "targetingLocations", "socialPostTitle", "socialCaption", "socialCta"]
          : ["campaignName", "keywords", "headlines", "descriptions", "displayPath", "cta", "targetingLocations", "socialPostTitle", "socialCaption", "socialCta"]
      );
      let descriptions = normalizeDescriptions(generated.descriptions, pkg);
      if (descriptions.length === 0) {
      const stricter = await generateAgencyFieldsWithAI(pkg, ["descriptions"], "force_variation");
      descriptions = normalizeDescriptions(stricter.descriptions, pkg);
      }
      applyGeneratedFields(pkg.rowId, {
        ...generated,
        descriptions: descriptions.length > 0 ? descriptions : deriveShortDescriptionFallback(pkg),
        socialPostTitle: generated.socialPostTitle ?? deriveSocialTitleFallback(pkg),
        socialCaption: generated.socialCaption ?? deriveSocialCaptionFallback(pkg)
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
                <p className="agency-copy">Choose whether this run needs Google Ads, social posts, or both, then review each location package.</p>
                <div className="mt-4 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${packageMode === "google" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}
                    onClick={() => setPackageModeForAll("google")}
                  >
                    Google Ads
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${packageMode === "social" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}
                    onClick={() => setPackageModeForAll("social")}
                  >
                    Social Post
                  </button>
                  <button
                    type="button"
                    className={`rounded-lg px-3 py-2 text-sm font-medium transition ${packageMode === "both" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}
                    onClick={() => setPackageModeForAll("both")}
                  >
                    Both
                  </button>
                </div>
              </div>
            </div>

            {aiError ? <p className="text-sm text-red-600">{aiError}</p> : null}

            {packages.map((pkg) => {
              const completeness = packageCompleteness(pkg);
              const selectedTemplate = AGENCY_TEMPLATES.find((item) => item.id === pkg.selectedTemplateId) ?? AGENCY_TEMPLATES[0];
              const open = expandedId === pkg.rowId;
              const activeView =
                pkg.packageMode === "google"
                  ? "google"
                  : pkg.packageMode === "social"
                    ? "social"
                    : packageViewMap[pkg.rowId] ?? "google";
              const previewPlatformId = socialPreviewMap[pkg.rowId] ?? pkg.selectedSocialPlatforms[0] ?? "facebook";
              const previewPlatform = getSocialPlatform(previewPlatformId);

              return (
                <div key={pkg.rowId} className="prod-pipeline">
                  <button type="button" className="prod-pipeline-head w-full text-left" onClick={() => setExpandedId(open ? null : pkg.rowId)}>
                    <div className={`agency-preview-thumb ${selectedTemplate.frameClass}`}>
                      {renderCreativePreview(pkg, "h-full w-full object-cover", true)}
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
                      {pkg.packageMode === "both" ? (
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${activeView === "google" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}
                            onClick={() => setPackageViewMap((prev) => ({ ...prev, [pkg.rowId]: "google" }))}
                          >
                            Google Ads
                          </button>
                          <button
                            type="button"
                            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${activeView === "social" ? "bg-white text-[#185FA5] shadow-sm" : "text-slate-600"}`}
                            onClick={() => setPackageViewMap((prev) => ({ ...prev, [pkg.rowId]: "social" }))}
                          >
                            Social Post
                          </button>
                        </div>
                        {activeView === "social" ? (
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            {SOCIAL_PLATFORM_OPTIONS.map((platform) => {
                              const selected = pkg.selectedSocialPlatforms.includes(platform.id);
                              return (
                                <button
                                  key={`${pkg.rowId}-top-${platform.id}`}
                                  type="button"
                                  onClick={() => toggleSocialPlatform(pkg.rowId, platform.id)}
                                  className={`grid h-11 w-11 place-items-center rounded-full border-2 transition ${selected ? "border-[#185FA5] bg-[#F3F8FE]" : "border-slate-200 bg-white"}`}
                                  title={platform.label}
                                  aria-label={platform.label}
                                >
                                  <img src={platform.icon.src} alt={platform.label} className="h-6 w-6 object-contain" />
                                </button>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                      ) : pkg.packageMode === "social" ? (
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {SOCIAL_PLATFORM_OPTIONS.map((platform) => {
                            const selected = pkg.selectedSocialPlatforms.includes(platform.id);
                            return (
                              <button
                                key={`${pkg.rowId}-top-${platform.id}`}
                                type="button"
                                onClick={() => toggleSocialPlatform(pkg.rowId, platform.id)}
                                className={`grid h-11 w-11 place-items-center rounded-full border-2 transition ${selected ? "border-[#185FA5] bg-[#F3F8FE]" : "border-slate-200 bg-white"}`}
                                title={platform.label}
                                aria-label={platform.label}
                              >
                                <img src={platform.icon.src} alt={platform.label} className="h-6 w-6 object-contain" />
                              </button>
                            );
                          })}
                        </div>
                      ) : null}

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

                      {activeView === "google" ? (
                      <>
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
                              {pkg.assetType === "video" ? (
                                <div className="space-y-3">
                                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                                    <video
                                      src={pkg.assetDataUrl || pkg.imageDataUrl}
                                      className="h-48 w-full object-cover"
                                      muted
                                      playsInline
                                      preload="metadata"
                                    />
                                  </div>
                                  <button
                                    type="button"
                                    className="flex w-full items-center justify-center rounded-xl border border-slate-200 bg-slate-50 px-4 py-8 text-sm font-medium text-slate-700 transition hover:border-[#185FA5] hover:text-[#185FA5]"
                                    onClick={() => setPreviewVideoPkg(pkg)}
                                  >
                                    ▶ Preview video
                                  </button>
                                  <p className="text-xs text-slate-500">Video creatives do not use image templates in this step.</p>
                                </div>
                              ) : (
                                <>
                                  <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                                    {AGENCY_TEMPLATES.map((template) => (
                                      <button
                                        key={template.id}
                                        type="button"
                                        onClick={() => patchPackage(pkg.rowId, { selectedTemplateId: template.id })}
                                        className={`agency-template-card ${pkg.selectedTemplateId === template.id ? "agency-template-card-active" : ""}`}
                                      >
                                        <div className={`agency-template-preview ${template.frameClass}`}>
                                          {renderCreativePreview(pkg, "h-full w-full object-cover", true)}
                                        </div>
                                        <span className="text-xs font-medium">{template.name}</span>
                                      </button>
                                    ))}
                                  </div>
                                  <button type="button" className="btn-secondary mt-3" onClick={() => applyToAll(pkg.rowId, "template")}>Apply template to all</button>
                                </>
                              )}
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
                      </>
                      ) : (
                        <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
                          <div className="card p-4">
                            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                              <div>
                                <p className="text-sm font-semibold">Social Post Package</p>
                                <p className="text-xs text-slate-500">Review the shared social copy and choose the platforms for this location.</p>
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="agency-editor-block">
                                <div className="agency-editor-head">
                                  <span className="agency-editor-title">Post title</span>
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                                    onClick={() => void regenerateField(pkg, "socialPostTitle")}
                                    disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "socialPostTitle")])}
                                  >
                                    {busyMap[getFieldBusyKey(pkg.rowId, "socialPostTitle")] ? "Generating..." : "✦ Regenerate"}
                                  </button>
                                </div>
                                <input
                                  className="field"
                                  value={pkg.socialPostTitle}
                                  onChange={(event) => patchPackage(pkg.rowId, { socialPostTitle: event.target.value })}
                                />
                              </div>

                              <div className="agency-editor-block">
                                <div className="agency-editor-head">
                                  <span className="agency-editor-title">Caption / body</span>
                                  <button
                                    type="button"
                                    className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                                    onClick={() => void regenerateField(pkg, "socialCaption")}
                                    disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "socialCaption")])}
                                  >
                                    {busyMap[getFieldBusyKey(pkg.rowId, "socialCaption")] ? "Generating..." : "✦ Regenerate"}
                                  </button>
                                </div>
                                <textarea
                                  className="field min-h-[140px] resize-y"
                                  value={pkg.socialCaption}
                                  onChange={(event) => patchPackage(pkg.rowId, { socialCaption: event.target.value })}
                                />
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="agency-editor-block">
                                  <div className="agency-editor-head">
                                    <span className="agency-editor-title">Social CTA</span>
                                    <button
                                      type="button"
                                      className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                                      onClick={() => void regenerateField(pkg, "socialCta")}
                                      disabled={Boolean(busyMap[getFieldBusyKey(pkg.rowId, "socialCta")])}
                                    >
                                      {busyMap[getFieldBusyKey(pkg.rowId, "socialCta")] ? "Generating..." : "✦ Regenerate"}
                                    </button>
                                  </div>
                                  <input
                                    className="field"
                                    value={pkg.socialCta}
                                    onChange={(event) => patchPackage(pkg.rowId, { socialCta: event.target.value })}
                                  />
                                </div>
                                <label className="block">
                                  <span className="mb-2 block text-xs font-medium uppercase tracking-wide text-slate-500">Social status</span>
                                  <select
                                    className="field"
                                    value={pkg.socialStatus}
                                    onChange={(event) => patchPackage(pkg.rowId, { socialStatus: event.target.value as AgencyPackage["socialStatus"] })}
                                  >
                                    <option>Draft</option>
                                    <option>Needs review</option>
                                    <option>Ready</option>
                                  </select>
                                </label>
                              </div>

                            </div>
                          </div>

                          <div className="space-y-4">
                            <div className="card p-4">
                              <div className="mb-3 flex items-center justify-between gap-3">
                                <div>
                                  <p className="text-sm font-semibold">Sample social preview</p>
                                  <p className="text-xs text-slate-500">Use the selected icons to preview the shared package on each platform.</p>
                                </div>
                              </div>
                              <div className="mb-3 flex flex-wrap gap-2">
                                {pkg.selectedSocialPlatforms.length > 0 ? pkg.selectedSocialPlatforms.map((platformId) => {
                                  const platform = getSocialPlatform(platformId);
                                  if (!platform) return null;
                                  return (
                                    <button
                                      key={`${pkg.rowId}-${platform.id}-preview`}
                                      type="button"
                                      onClick={() => setSocialPreviewMap((prev) => ({ ...prev, [pkg.rowId]: platform.id }))}
                                      className={`rounded-full border p-2 transition ${previewPlatformId === platform.id ? "border-[#185FA5] bg-[#F3F8FE]" : "border-slate-200 bg-white"}`}
                                    >
                                      <img src={platform.icon.src} alt={platform.label} className="h-6 w-6 object-contain" />
                                    </button>
                                  );
                                }) : (
                                  <span className="text-sm text-slate-500">Select at least one platform to preview.</span>
                                )}
                              </div>
                              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                                <div className="mb-3 flex items-center gap-3">
                                  {previewPlatform ? <img src={previewPlatform.icon.src} alt={previewPlatform.label} className="h-8 w-8 object-contain" /> : null}
                                  <div>
                                    <p className="text-sm font-semibold">{previewPlatform?.label ?? "Social preview"}</p>
                                    <p className="text-xs text-slate-500">{pkg.location}</p>
                                  </div>
                                </div>
                                <div className="mb-3 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
                                  {renderCreativePreview(pkg, "h-56 w-full object-cover", true)}
                                </div>
                                <div className="space-y-2">
                                  <p className="text-base font-semibold text-slate-900">{pkg.socialPostTitle}</p>
                                  <p className="text-sm leading-6 text-slate-600">{pkg.socialCaption}</p>
                                  <div className="inline-flex rounded-full bg-[#F3F8FE] px-3 py-1 text-xs font-medium text-[#185FA5]">{pkg.socialCta}</div>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
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
      {previewVideoPkg ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4" onClick={() => setPreviewVideoPkg(null)}>
          <div className="w-full max-w-3xl rounded-2xl bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold">{previewVideoPkg.location}</p>
                <p className="text-xs text-slate-500">{previewVideoPkg.assetName || "Video preview"}</p>
              </div>
              <button type="button" className="text-sm text-slate-500 hover:text-slate-900" onClick={() => setPreviewVideoPkg(null)}>
                Close
              </button>
            </div>
            <video
              src={previewVideoPkg.assetDataUrl || previewVideoPkg.imageDataUrl}
              className="max-h-[70vh] w-full rounded-xl bg-black"
              controls
              autoPlay
              playsInline
              preload="metadata"
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
