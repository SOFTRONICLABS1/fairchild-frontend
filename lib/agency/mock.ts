"use client";

export const AGENCY_SESSION_ROWS_KEY = "agency:upload-rows";
export const AGENCY_SESSION_PACKAGES_KEY = "agency:packages";

export type AgencyRow = {
  id: string;
  location: string;
  landingPageUrl: string;
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
  location: string;
  landingPageUrl: string;
  imageDataUrl: string;
  imageName: string;
  campaignName: string;
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  displayPath: string;
  cta: string;
  status: "Draft" | "Needs review" | "Ready";
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

export function deriveDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return "brand.example";
  }
}

export function rowIsValid(row: AgencyRow): boolean {
  return Boolean(row.location.trim() && row.landingPageUrl.trim() && row.imageDataUrl);
}

export function createEmptyAgencyRow(): AgencyRow {
  return {
    id: `agency-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    location: "",
    landingPageUrl: "",
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

  return {
    rowId: row.id,
    location: row.location,
    landingPageUrl: row.landingPageUrl,
    imageDataUrl: row.imageDataUrl,
    imageName: row.imageName,
    campaignName: `${domainName} - ${locationName} - Local Campaign`,
    keywords,
    headlines,
    descriptions,
    displayPath: pathBase || "local/offer",
    cta: "Book now",
    status: "Ready",
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
  } else if (row.imageDataUrl) {
    warnings.push("Image dimensions unavailable; review fit before publish.");
  }
  if (row.imageName && /text|poster|flyer|banner/i.test(row.imageName)) {
    warnings.push("Creative may contain heavy text; review readability.");
  }
  return warnings;
}

export function packageCompleteness(pkg: AgencyPackage): number {
  let score = 0;
  if (pkg.location.trim()) score += 1;
  if (pkg.landingPageUrl.trim()) score += 1;
  if (pkg.keywords.filter(Boolean).length >= 3) score += 1;
  if (pkg.headlines.filter(Boolean).length >= 5) score += 1;
  if (pkg.descriptions.filter(Boolean).length >= 4) score += 1;
  if (pkg.selectedTemplateId) score += 1;
  return Math.round((score / 6) * 100);
}

export function loadAgencyRows(): AgencyRow[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = sessionStorage.getItem(AGENCY_SESSION_ROWS_KEY);
    return raw ? (JSON.parse(raw) as AgencyRow[]) : [];
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
    return raw ? (JSON.parse(raw) as AgencyPackage[]) : [];
  } catch {
    return [];
  }
}

export function saveAgencyPackages(packages: AgencyPackage[]) {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(AGENCY_SESSION_PACKAGES_KEY, JSON.stringify(packages));
}
