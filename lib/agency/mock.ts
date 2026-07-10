"use client";

export const AGENCY_SESSION_ROWS_KEY = "agency:upload-rows";
export const AGENCY_SESSION_PACKAGES_KEY = "agency:packages";

export type AgencyAssetType = "image" | "video";
export type AgencySocialStatus = "Draft" | "Needs review" | "Ready";
export type AgencyPackageView = "google" | "social";
export type AgencyPackageMode = "google" | "social" | "both";
export type SocialPlatformId = "facebook" | "instagram" | "linkedin" | "pinterest" | "reddit" | "tiktok" | "twitter";

export type AgencyRow = {
  id: string;
  brandId?: string;
  locationId?: string;
  location: string;
  landingPageUrl: string;
  assetType: AgencyAssetType;
  assetDataUrl: string;
  assetName: string;
  assetDurationSeconds?: number;
  imageDataUrl: string;
  imageName: string;
  imageWidth?: number;
  imageHeight?: number;
};

export type AgencyTemplate = {
  id: string;
  name: string;
  frameClass: string;
  accent: string;
};

export type AgencyPackage = {
  rowId: string;
  brandId?: string;
  locationId?: string;
  location: string;
  landingPageUrl: string;
  assetType: AgencyAssetType;
  assetDataUrl: string;
  assetName: string;
  assetDurationSeconds?: number;
  imageDataUrl: string;
  imageName: string;
  campaignName: string;
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  displayPath: string;
  cta: string;
  targetingLocations: string[];
  status: "Draft" | "Needs review" | "Ready";
  socialPostTitle: string;
  socialCaption: string;
  socialCta: string;
  selectedSocialPlatforms: SocialPlatformId[];
  socialStatus: AgencySocialStatus;
  packageMode: AgencyPackageMode;
  selectedTemplateId: string;
  warnings: string[];
};

export const AGENCY_TEMPLATES: AgencyTemplate[] = [
  { id: "clean-grid", name: "Clean Grid", frameClass: "agency-template-frame-clean", accent: "#185FA5" },
  { id: "promo-badge", name: "Promo Badge", frameClass: "agency-template-frame-badge", accent: "#D97706" },
  { id: "headline-strip", name: "Headline Strip", frameClass: "agency-template-frame-strip", accent: "#0B6B4B" }
];

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/www\./g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function wordsFromText(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, " ")
    .replace(/www\./g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .map((item) => item.trim())
    .filter(Boolean);
}

function uniqueWords(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function toTitleCase(value: string): string {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function clampText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

export function deriveDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "brand.example";
  }
}

export function rowIsValid(row: AgencyRow): boolean {
  return Boolean(row.location.trim() && row.landingPageUrl.trim() && (row.assetDataUrl || row.imageDataUrl));
}

export function createEmptyAgencyRow(): AgencyRow {
  return {
    id: `agency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    brandId: undefined,
    location: "",
    landingPageUrl: "",
    assetType: "image",
    assetDataUrl: "",
    assetName: "",
    imageDataUrl: "",
    imageName: ""
  };
}

export function mockAgencyPackage(row: AgencyRow): AgencyPackage {
  const domain = deriveDomain(row.landingPageUrl);
  const domainBase = domain.split(".")[0] || "brand";
  const domainName = toTitleCase(domainBase.replace(/[-_]/g, " "));
  const locationName = row.location.trim() || "Location";
  const fileHint = toTitleCase(
    row.imageName
      .replace(/\.[a-z0-9]+$/i, "")
      .replace(/[_-]+/g, " ")
      .trim()
  );

  const keywordPool = uniqueWords([
    ...wordsFromText(locationName),
    ...wordsFromText(domainBase),
    ...wordsFromText(fileHint)
  ]).filter((word) => word.length > 2);

  const keywords = [
    `${locationName} ${domainName}`.trim(),
    `${domainName} near me`.trim(),
    `${domainName} offers`.trim(),
    keywordPool.slice(0, 2).join(" ").trim()
  ]
    .filter(Boolean)
    .slice(0, 4);

  const headlines = [
    `${domainName} in ${locationName}`,
    `Book ${domainName} Today`,
    `${locationName} Deals Available`,
    `${domainName} Local Offers`,
    fileHint ? `${fileHint} at ${domainName}` : `${domainName} Starts Here`
  ].slice(0, 5);

  const descriptions = [
    `Drive local traffic for ${locationName} with a focused landing page and creative tailored to nearby customers.`,
    `Use this campaign to highlight key offers, location-specific messaging, and clear conversion intent.`,
    `Pair the uploaded image with concise ad copy to improve creative consistency across locations.`,
    `Review the asset fit, refine the headlines, and publish when the package is ready.`
  ].slice(0, 4);

  const pathBase = slugify(locationName).split("-").filter(Boolean).slice(0, 2).join("/");
  const socialTitle = clampText(`${domainName} in ${locationName}`, 70);
  const socialCaption = clampText(
    `Discover ${domainName} in ${locationName}. Explore local offers, standout creative, and click through to learn more.`,
    220
  );

  return {
    rowId: row.id,
    brandId: row.brandId,
    locationId: row.locationId,
    location: row.location,
    landingPageUrl: row.landingPageUrl,
    assetType: row.assetType ?? "image",
    assetDataUrl: row.assetDataUrl || row.imageDataUrl,
    assetName: row.assetName || row.imageName,
    assetDurationSeconds: row.assetDurationSeconds,
    imageDataUrl: row.imageDataUrl,
    imageName: row.imageName,
    campaignName: `${domainName} - ${locationName} - Local Campaign`,
    keywords,
    headlines,
    descriptions,
    displayPath: pathBase || "local/offer",
    cta: "Book now",
    targetingLocations: [],
    status: "Ready",
    socialPostTitle: socialTitle,
    socialCaption,
    socialCta: "Learn more",
    selectedSocialPlatforms: ["facebook", "instagram"],
    socialStatus: "Ready",
    packageMode: "both",
    selectedTemplateId: AGENCY_TEMPLATES[0].id,
    warnings: deriveWarnings(row)
  };
}

export function deriveWarnings(row: AgencyRow): string[] {
  const warnings: string[] = [];
  if (row.imageWidth && row.imageHeight) {
    const ratio = row.imageWidth / row.imageHeight;
    if (ratio < 0.8 || ratio > 1.91) {
      warnings.push("Aspect ratio may need template cropping.");
    }
    if (row.imageWidth < 900 || row.imageHeight < 900) {
      warnings.push("Resolution is on the low side for ad creative.");
    }
  } else if (row.assetDataUrl || row.imageDataUrl) {
    warnings.push(`${row.assetType === "video" ? "Video" : "Image"} dimensions unavailable; review fit before publish.`);
  }
  if (row.assetType === "video" && row.assetDurationSeconds && row.assetDurationSeconds > 30) {
    warnings.push("Video is long for a quick preview. Review before publish.");
  }
  if (row.imageName && /text|poster|flyer|banner/i.test(row.imageName)) {
    warnings.push("Creative may contain heavy text; review readability.");
  }
  return warnings;
}

export function packageCompleteness(pkg: AgencyPackage): number {
  let score = 0;
  if (pkg.location.trim()) score += 1;
  if (pkg.campaignName.trim()) score += 1;
  if (pkg.landingPageUrl.trim()) score += 1;
  if (pkg.cta.trim()) score += 1;
  if (pkg.targetingLocations.length > 0) score += 1;
  if (pkg.keywords.filter(Boolean).length > 0) score += 1;
  if (pkg.headlines.filter(Boolean).length >= 5) score += 1;
  if (pkg.descriptions.filter(Boolean).length >= 4) score += 1;
  if (pkg.socialPostTitle.trim()) score += 1;
  if (pkg.socialCaption.trim()) score += 1;
  if (pkg.socialCta.trim()) score += 1;
  if (pkg.selectedSocialPlatforms.length > 0) score += 1;
  if (pkg.selectedTemplateId) score += 1;
  return Math.round((score / 12) * 100);
}

export function loadAgencyRows(): AgencyRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(AGENCY_SESSION_ROWS_KEY);
    return raw
      ? (JSON.parse(raw) as Array<Partial<AgencyRow>>).map((row) => ({
          id: row.id ?? `agency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          brandId: row.brandId,
          locationId: row.locationId,
          location: row.location ?? "",
          landingPageUrl: row.landingPageUrl ?? "",
          assetType: row.assetType ?? "image",
          assetDataUrl: row.assetDataUrl ?? row.imageDataUrl ?? "",
          assetName: row.assetName ?? row.imageName ?? "",
          assetDurationSeconds: row.assetDurationSeconds,
          imageDataUrl: row.imageDataUrl ?? row.assetDataUrl ?? "",
          imageName: row.imageName ?? row.assetName ?? "",
          imageWidth: row.imageWidth,
          imageHeight: row.imageHeight
        }))
      : [];
  } catch {
    return [];
  }
}

export function saveAgencyRows(rows: AgencyRow[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AGENCY_SESSION_ROWS_KEY, JSON.stringify(rows));
}

export function loadAgencyPackages(): AgencyPackage[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(AGENCY_SESSION_PACKAGES_KEY);
    return raw
      ? (JSON.parse(raw) as Array<Partial<AgencyPackage>>).map((pkg) => ({
          ...pkg,
          assetType: pkg.assetType ?? "image",
          assetDataUrl: pkg.assetDataUrl ?? pkg.imageDataUrl ?? "",
          assetName: pkg.assetName ?? pkg.imageName ?? "",
          imageDataUrl: pkg.imageDataUrl ?? pkg.assetDataUrl ?? "",
          imageName: pkg.imageName ?? pkg.assetName ?? "",
          targetingLocations: Array.isArray(pkg.targetingLocations) ? pkg.targetingLocations : [],
          socialPostTitle: pkg.socialPostTitle ?? `${pkg.location ?? "Location"} • ${pkg.campaignName ?? "Campaign"}`,
          socialCaption: pkg.socialCaption ?? `Share ${pkg.location ?? "this location"} across your selected social channels with a single reviewed creative package.`,
          socialCta: pkg.socialCta ?? "Learn more",
          selectedSocialPlatforms: Array.isArray(pkg.selectedSocialPlatforms) && pkg.selectedSocialPlatforms.length > 0 ? pkg.selectedSocialPlatforms as SocialPlatformId[] : ["facebook", "instagram"],
          socialStatus: pkg.socialStatus ?? pkg.status ?? "Draft",
          packageMode: pkg.packageMode ?? "both"
        })) as AgencyPackage[]
      : [];
  } catch {
    return [];
  }
}

export function saveAgencyPackages(packages: AgencyPackage[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AGENCY_SESSION_PACKAGES_KEY, JSON.stringify(packages));
}
