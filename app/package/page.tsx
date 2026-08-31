"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getDisplayMessage, getErrorMeta } from "@/lib/api/errors";
import { generateJson } from "@/lib/ai/generate";
import { loadWordPressCategories, type WordPressCategoryOption } from "@/lib/wordpress/categories";

type SelectedProduct = {
  id: string;
  product: string;
  companyName?: string;
  campaignId?: string;
  imageUrl: string;
  productUrl: string;
  platform: "CJ" | "Impact";
  price: number;
  discount: number;
};

type PostPackage = {
  Image_editing_text: string;
  name: string;
  type: "external";
  status: "draft" | "pending" | "private" | "publish";
  wordpress_category: WordPressCategoryOption | null;
  metricool_schedule_datetime: string;
  metricool_status: "draft" | "publish";
  featured: boolean;
  catalog_visibility: "visible";
  description: string;
  short_description: string;
  external_url: string;
  button_text: string;
  regular_price: string;
  sale_price: string;
  images: Array<{ id: number }>;
  meta_data: Array<{ key: string; value: string }>;
  // The rendered creative from the last preview, plus the exact caption it was rendered
  // with. The pipeline reuses this render only while render_preview_text still matches
  // the current Image_editing_text — an edit after previewing makes it stale.
  render_preview_href?: string;
  render_preview_text?: string;
};

type RenderPreviewStatus = "idle" | "rendering" | "ready" | "blank" | "error";
type RenderPreviewState = { status: RenderPreviewStatus; error?: string };

// Products are prepared in parallel, but capped: each one is a Claude call plus a RenderForm
// render, and firing 20 of each at once trips both providers' rate limits.
const GENERATION_CONCURRENCY = 4;

async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>) {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
}

type AIPackageFields = {
  Image_editing_text?: string;
  name?: string;
  description?: string;
  short_description?: string;
  button_text?: string;
  metricool_schedule_datetime?: string;
};

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDefaultMetricoolSchedule(): string {
  const future = new Date(Date.now() + 24 * 60 * 60 * 1000);
  future.setMinutes(0, 0, 0);
  future.setHours(10);
  return `${formatLocalDate(future)}T10:00:00`;
}

function parseScheduleParts(value: string): { date: string; hour12: string; minute: string; period: "AM" | "PM" } {
  const fallbackDate = formatLocalDate(new Date(Date.now() + 24 * 60 * 60 * 1000));
  if (!value || !value.includes("T")) {
    return { date: fallbackDate, hour12: "10", minute: "00", period: "AM" };
  }
  const [datePart, timePartRaw] = value.split("T");
  const [hourRaw = "10", minuteRaw = "00"] = timePartRaw.split(":");
  const hour24 = Number(hourRaw);
  if (!Number.isFinite(hour24)) {
    return { date: datePart || fallbackDate, hour12: "10", minute: "00", period: "AM" };
  }
  const period: "AM" | "PM" = hour24 >= 12 ? "PM" : "AM";
  const hour12Num = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return {
    date: datePart || fallbackDate,
    hour12: String(hour12Num).padStart(2, "0"),
    minute: String(Number(minuteRaw) || 0).padStart(2, "0"),
    period
  };
}

function buildScheduleIso(date: string, hour12: string, minute: string, period: "AM" | "PM"): string {
  const baseHour = Number(hour12) % 12;
  const hour24 = period === "PM" ? baseHour + 12 : baseHour;
  return `${date}T${String(hour24).padStart(2, "0")}:${minute}:00`;
}

function clampScheduleWithinWindow(input: string): string {
  const now = new Date();
  const min = new Date(now.getTime() + 60 * 60 * 1000);
  const max = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const parsed = new Date(input);
  if (!Number.isFinite(parsed.getTime())) return getDefaultMetricoolSchedule();
  if (parsed < min) return `${formatLocalDate(min)}T${String(min.getHours()).padStart(2, "0")}:${String(min.getMinutes()).padStart(2, "0")}:00`;
  if (parsed > max) return `${formatLocalDate(max)}T${String(max.getHours()).padStart(2, "0")}:${String(max.getMinutes()).padStart(2, "0")}:00`;
  return `${formatLocalDate(parsed)}T${String(parsed.getHours()).padStart(2, "0")}:${String(parsed.getMinutes()).padStart(2, "0")}:00`;
}

function normalizeTypedTime(value: string): { hour12: string; minute: string } {
  const cleaned = value.trim();
  const match = cleaned.match(/^(\d{1,2}):(\d{1,2})$/);
  if (!match) return { hour12: "10", minute: "00" };
  let hour = Number(match[1]);
  let minute = Number(match[2]);
  if (!Number.isFinite(hour) || hour < 1) hour = 1;
  if (hour > 12) hour = 12;
  if (!Number.isFinite(minute) || minute < 0) minute = 0;
  if (minute > 59) minute = 59;
  return {
    hour12: String(hour).padStart(2, "0"),
    minute: String(minute).padStart(2, "0")
  };
}

function normalizeName(title: string): string {
  return title
    .replace(/\s*\|\s*[^|]+$/g, "")
    .replace(/\s*-\s*(xs|s|m|l|xl|xxl|small|medium|large|x-large)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

// A rotation, not one constant: the fallback fires whenever the model slips a number into
// the caption, and a single constant meant every such product came out reading "Big Savings".
const IMAGE_TEXT_FALLBACKS = [
  "Big Savings",
  "Deal Alert",
  "Shop The Drop",
  "Limited Stock",
  "Fresh Arrival",
  "Steal This Look",
  "Grab It Now",
  "Today Only",
  "Hot Pick",
  "Don't Miss Out"
];

/**
 * Image overlay text is set in words, never figures: a baked-in "63% off" goes stale the
 * moment the discount changes, and the figure already shows next to the post. The prompt
 * asks for words, so this is the backstop — a phrase carrying any number, percent or price
 * is replaced outright, since stripping just the numeric token leaves debris ("63% off"
 * would become "off").
 *
 * `usedTexts` keeps captions distinct across the batch: a clean phrase that duplicates one
 * already taken is passed over, and the fallback picks the first unused rotation entry.
 */
function sanitizeImageText(text: string, usedTexts: string[] = []): string {
  const used = new Set(usedTexts.map((entry) => entry.trim().toLowerCase()).filter(Boolean));
  const phrase = text.trim().replace(/\s+/g, " ");
  const isClean = Boolean(phrase) && !/[\d%$£€]/.test(phrase);
  if (isClean) {
    const trimmed = phrase.split(" ").slice(0, 3).join(" ");
    if (!used.has(trimmed.toLowerCase())) return trimmed;
  }
  const unusedFallback = IMAGE_TEXT_FALLBACKS.find((entry) => !used.has(entry.toLowerCase()));
  return unusedFallback ?? IMAGE_TEXT_FALLBACKS[used.size % IMAGE_TEXT_FALLBACKS.length];
}

function urlHint(url: string): string {
  try {
    const parsed = new URL(url);
    const fromPath = parsed.pathname
      .toLowerCase()
      .replace(/[^a-z0-9/\\-]/g, " ")
      .split(/[\\/\\-]+/)
      .filter(Boolean)
      .filter((part) => !["shop", "product", "products", "en", "us", "www", "com", "t", "p"].includes(part))
      .slice(0, 8)
      .join(" ");
    return fromPath || "none";
  } catch {
    return "none";
  }
}

function normalizeCategoryLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isUncategorizedCategory(category: WordPressCategoryOption): boolean {
  return normalizeCategoryLabel(category.name) === "uncategorized";
}

function pickFallbackCategory(categories: WordPressCategoryOption[]): WordPressCategoryOption | null {
  if (categories.length === 0) return null;
  return categories.find((category) => !isUncategorizedCategory(category)) ?? categories[0];
}

function buildCategoryContextTokens(product: SelectedProduct, postPackage: PostPackage): string[] {
  const source = [
    product.product,
    product.companyName ?? "",
    postPackage.name,
    postPackage.description,
    postPackage.short_description,
    urlHint(postPackage.external_url)
  ].join(" ");

  return Array.from(
    new Set(
      source
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 3)
    )
  );
}

function scoreCategoryOption(category: WordPressCategoryOption, tokens: string[]): number {
  const label = normalizeCategoryLabel(category.name);
  let score = 0;
  tokens.forEach((token, index) => {
    if (label === token) score += 120 - index;
    else if (label.startsWith(`${token} `) || label.endsWith(` ${token}`)) score += 70 - index;
    else if (label.includes(token)) score += 35 - index;
  });
  return score;
}

function pickDeterministicCategory(
  categories: WordPressCategoryOption[],
  product: SelectedProduct,
  postPackage: PostPackage
): WordPressCategoryOption | null {
  const tokens = buildCategoryContextTokens(product, postPackage);
  const scored = categories
    .filter((category) => !isUncategorizedCategory(category))
    .map((category) => ({ category, score: scoreCategoryOption(category, tokens) }))
    .sort((left, right) => right.score - left.score);
  if (scored[0] && scored[0].score > 0) return scored[0].category;
  return pickFallbackCategory(categories);
}

function buildCategoryCandidates(
  categories: WordPressCategoryOption[],
  product: SelectedProduct,
  postPackage: PostPackage
): WordPressCategoryOption[] {
  const tokens = buildCategoryContextTokens(product, postPackage);
  const scored = categories
    .filter((category) => !isUncategorizedCategory(category))
    .map((category) => ({ category, score: scoreCategoryOption(category, tokens) }))
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 30)
    .map((item) => item.category);

  if (scored.length > 0) return scored;
  const filtered = categories.filter((category) => !isUncategorizedCategory(category));
  return (filtered.length > 0 ? filtered : categories).slice(0, 30);
}

function createPackage(product: SelectedProduct): PostPackage {
  const salePrice = product.discount > 0 ? product.price : 0;
  const regularPrice = product.discount > 0
    ? product.price / (1 - product.discount / 100)
    : product.price;

  return {
    Image_editing_text: "Keyname_Value",
    name: normalizeName(product.product),
    type: "external",
    status: "publish",
    wordpress_category: null,
    metricool_schedule_datetime: getDefaultMetricoolSchedule(),
    metricool_status: "publish",
    featured: true,
    catalog_visibility: "visible",
    description: "Keyname_Value",
    short_description: "Keyname_Value",
    external_url: product.productUrl,
    button_text: "Buy Now",
    regular_price: regularPrice.toFixed(2),
    sale_price: salePrice > 0 ? salePrice.toFixed(2) : "",
    images: [{ id: 0 }],
    meta_data: [{ key: "vendor", value: "Keyname_Value" }]
  };
}

export default function PackagePage() {
  const router = useRouter();
  const initialGenerationStartedRef = useRef(false);
  const [products, setProducts] = useState<SelectedProduct[]>([]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [templateName, setTemplateName] = useState<string | null>(null);
  // Which product editors are expanded. Each row opens and closes on its own, so several
  // can be compared side by side.
  const [openIndices, setOpenIndices] = useState<number[]>([0]);
  const [confirmDeleteIndex, setConfirmDeleteIndex] = useState<number | null>(null);
  // Captions handed out so far this session, so no two posts get the same image text.
  const usedImageTextsRef = useRef<string[]>([]);
  const [packages, setPackages] = useState<PostPackage[]>([]);
  const [savedTick, setSavedTick] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [regeneratingFields, setRegeneratingFields] = useState<Record<string, boolean>>({});
  const [aiReadyByProduct, setAiReadyByProduct] = useState<Record<string, boolean>>({});
  const [scheduleTimeInput, setScheduleTimeInput] = useState("10:00");
  const [wordpressCategories, setWordpressCategories] = useState<WordPressCategoryOption[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  const [renderPreview, setRenderPreview] = useState<Record<number, RenderPreviewState>>({});

  useEffect(() => {
    const raw = sessionStorage.getItem("pipeline:selected-products");
    setTemplateId(sessionStorage.getItem("pipeline:selected-template"));
    setTemplateName(sessionStorage.getItem("pipeline:selected-template-name"));
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as SelectedProduct[];
      setProducts(parsed);
      const created = parsed.map(createPackage);
      setPackages(created);
      const defaultAiReady: Record<string, boolean> = {};
      parsed.forEach((product) => {
        defaultAiReady[product.id] = false;
      });
      setAiReadyByProduct(defaultAiReady);
      sessionStorage.setItem("pipeline:post-packages", JSON.stringify(created));
    } catch {
      setProducts([]);
      setPackages([]);
    }
  }, []);

  useEffect(() => {
    const loadCategories = async () => {
      setCategoriesLoading(true);
      setCategoriesError(null);
      try {
        const categories = await loadWordPressCategories();
        setWordpressCategories(categories);
      } catch (error) {
        setCategoriesError(getDisplayMessage(error) || "Failed to load WordPress categories");
      } finally {
        setCategoriesLoading(false);
      }
    };
    void loadCategories();
  }, []);

  // Header actions and the summary panel act on the topmost expanded post.
  const primaryOpenIndex = useMemo(
    () => (openIndices.length === 0 ? null : Math.min(...openIndices)),
    [openIndices]
  );
  const activeProduct = useMemo(
    () => (primaryOpenIndex === null ? null : products[primaryOpenIndex] ?? null),
    [products, primaryOpenIndex]
  );
  const activePackage = useMemo(
    () => (primaryOpenIndex === null ? null : packages[primaryOpenIndex] ?? null),
    [packages, primaryOpenIndex]
  );
  const isProductReady = (index: number) => {
    const product = products[index];
    return product ? Boolean(aiReadyByProduct[product.id]) : false;
  };
  const activeProductReady = primaryOpenIndex === null ? false : isProductReady(primaryOpenIndex);

  const selectCategoryWithAI = async (
    product: SelectedProduct,
    base: PostPackage,
    categories: WordPressCategoryOption[],
    mode: "default" | "force_variation" = "default"
  ): Promise<WordPressCategoryOption | null> => {
    if (categories.length === 0) return null;

    const candidates = buildCategoryCandidates(categories, product, base);
    const deterministicMatch = pickDeterministicCategory(categories, product, base);
    const prompt = `
You choose ONE WordPress ecommerce product category.
Return ONLY strict JSON. No markdown.

Required JSON shape:
{
  "categoryId": 0,
  "categoryName": ""
}

Choose exactly one category from this allowed list:
${JSON.stringify(candidates)}

Context:
{
  "product": ${JSON.stringify(product.product)},
  "companyName": ${JSON.stringify(product.companyName ?? "")},
  "platform": ${JSON.stringify(product.platform)},
  "external_url": ${JSON.stringify(base.external_url)},
  "url_hint_tokens": ${JSON.stringify(urlHint(base.external_url))},
  "description": ${JSON.stringify(base.description)},
  "short_description": ${JSON.stringify(base.short_description)}
}

Rules:
- categoryId must come from the allowed list.
- categoryName must match the selected allowed category exactly.
- Choose the single best matching product category.
${mode === "force_variation" ? "- If multiple categories are plausible, choose a different valid option than the last one." : ""}
    `.trim();

    let parsed: { categoryId?: unknown; categoryName?: unknown };
    try {
      parsed = await generateJson<{ categoryId?: unknown; categoryName?: unknown }>({
        prompt,
        maxTokens: 512,
        temperature: 0.4
      });
    } catch {
      // Category selection is best-effort; fall back to the deterministic keyword match
      // rather than failing the whole regenerate.
      return deterministicMatch;
    }
    const categoryId = Number(parsed.categoryId);
    const categoryName = typeof parsed.categoryName === "string" ? parsed.categoryName.trim() : "";

    const exactById = categories.find((category) => category.id === categoryId);
    if (exactById && (!categoryName || exactById.name === categoryName)) return exactById;

    const exactByName = categories.find((category) => normalizeCategoryLabel(category.name) === normalizeCategoryLabel(categoryName));
    if (exactByName) return exactByName;

    return deterministicMatch;
  };

  const flashSaved = () => {
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 1200);
  };

  const patchPackageAt = (index: number, updates: Partial<PostPackage>) => {
    setPackages((prev) => {
      const next = prev.map((item, idx) => (idx === index ? { ...item, ...updates } : item));
      sessionStorage.setItem("pipeline:post-packages", JSON.stringify(next));
      return next;
    });
  };

  const patchAt = <K extends keyof PostPackage>(index: number, key: K, value: PostPackage[K]) => {
    patchPackageAt(index, { [key]: value } as Partial<PostPackage>);
  };

  const toggleOpen = (index: number) => {
    setOpenIndices((prev) => (prev.includes(index) ? prev.filter((item) => item !== index) : [...prev, index]));
  };

  /**
   * Drops a product from the run. renderPreview, regeneratingFields and openIndices are all
   * keyed by position, so everything after the removed row shifts down by one — without this
   * reindexing, the remaining posts would show each other's previews.
   */
  const removeProduct = (index: number) => {
    const removed = products[index];
    const nextProducts = products.filter((_, idx) => idx !== index);
    const nextPackages = packages.filter((_, idx) => idx !== index);

    setProducts(nextProducts);
    setPackages(nextPackages);
    sessionStorage.setItem("pipeline:selected-products", JSON.stringify(nextProducts));
    sessionStorage.setItem("pipeline:post-packages", JSON.stringify(nextPackages));

    setRenderPreview((prev) => {
      const next: Record<number, RenderPreviewState> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const position = Number(key);
        if (position === index) return;
        next[position > index ? position - 1 : position] = value;
      });
      return next;
    });

    setRegeneratingFields((prev) => {
      const next: Record<string, boolean> = {};
      Object.entries(prev).forEach(([key, value]) => {
        const [positionRaw, field] = key.split(":");
        const position = Number(positionRaw);
        if (position === index) return;
        next[`${position > index ? position - 1 : position}:${field}`] = value;
      });
      return next;
    });

    setOpenIndices((prev) =>
      prev.filter((item) => item !== index).map((item) => (item > index ? item - 1 : item))
    );

    if (removed) {
      setAiReadyByProduct((prev) => {
        const next = { ...prev };
        delete next[removed.id];
        return next;
      });
    }
    setConfirmDeleteIndex(null);
  };

  // Core render call. Takes the image/caption explicitly so the initial parallel run can
  // fire it with freshly generated text without waiting for that text to land in state.
  const renderPreviewFor = async (index: number, imageSrc: string, titleText: string, template: string) => {
    const trimmed = titleText.trim();
    if (!imageSrc || !trimmed || !template) return;
    setRenderPreview((prev) => ({ ...prev, [index]: { status: "rendering" } }));
    try {
      const response = await http.post("/api/v1/renderform/render", {
        template,
        titleText: trimmed,
        imageSrc,
        extraData: {}
      });
      const data = unwrapEnvelope<{ href: string }>(response.data);
      patchPackageAt(index, { render_preview_href: data.href, render_preview_text: trimmed });
      setRenderPreview((prev) => ({ ...prev, [index]: { status: "ready" } }));
    } catch (renderError) {
      const meta = getErrorMeta(renderError);
      const isBlank = meta.code === "IMAGE_INVALID_OR_BLANK";
      setRenderPreview((prev) => ({
        ...prev,
        [index]: {
          status: isBlank ? "blank" : "error",
          error: isBlank
            ? "This came back blank — RenderForm didn't place the product photo on this template. Click Regenerate to try again, or go back and pick a different template."
            : meta.message || "Preview failed."
        }
      }));
    }
  };

  // Manual "Regenerate" on the preview card — reads whatever is currently in state.
  const runRenderPreview = async (index: number) => {
    const product = products[index];
    const pkg = packages[index];
    if (!product || !pkg || !templateId) return;
    await renderPreviewFor(index, product.imageUrl, pkg.Image_editing_text ?? "", templateId);
  };

  const setFieldLoading = (index: number, key: keyof PostPackage, value: boolean) => {
    const stateKey = `${index}:${key}`;
    setRegeneratingFields((prev) => ({ ...prev, [stateKey]: value }));
  };


  const generateFieldsWithAI = async (
    product: SelectedProduct,
    base: PostPackage,
    fields: Array<keyof PostPackage>,
    mode: "default" | "force_variation" = "default"
  ): Promise<AIPackageFields> => {
    const allowed = ["Image_editing_text", "name", "description", "short_description", "button_text", "metricool_schedule_datetime"];
    const requested = fields.filter((field) => allowed.includes(field));
    if (requested.length === 0) return {};

    // Captions already taken by other posts in this batch, so each product gets its own.
    const usedImageTexts = usedImageTextsRef.current.filter(
      (entry) => entry.trim().toLowerCase() !== (base.Image_editing_text ?? "").trim().toLowerCase()
    );

    const prompt = `
You generate ecommerce post-package fields.
Return ONLY strict JSON. No markdown.

Allowed keys:
- Image_editing_text: one short punchy phrase (1-3 words), words only
- name: clean product title, remove sizes/codes/noise
- description: 2-4 sentence marketing copy
- short_description: one concise sentence
- button_text: CTA text
- metricool_schedule_datetime: local datetime in format YYYY-MM-DDTHH:mm:ss

Generate ONLY these keys: ${requested.join(", ")}

Context:
{
  "product": ${JSON.stringify(product.product)},
  "companyName": ${JSON.stringify(product.companyName ?? "")},
  "platform": ${JSON.stringify(product.platform)},
  "price": ${JSON.stringify(base.sale_price || base.regular_price)},
  "regular_price": ${JSON.stringify(base.regular_price)},
  "sale_price": ${JSON.stringify(base.sale_price)},
  "external_url": ${JSON.stringify(base.external_url)},
  "url_hint_tokens": ${JSON.stringify(urlHint(base.external_url))},
  "already_used_captions": ${JSON.stringify(usedImageTexts)}
}

Rules:
- ALWAYS write every field in English, even when the source product title is in another
  language. Translate the product title rather than echoing it. Keep brand names, model
  names and team names as-is (e.g. "Nike", "Cincinnati Bengals", "Joe Burrow").
- Image_editing_text must be words only. NEVER include a digit, "%", or a price — not even
  spelled next to words. "63% off", "Save 40%", "$29.99" are all invalid. Valid: "Half Price",
  "Fresh Drop", "Court Ready".
- Image_editing_text must be specific to THIS product (its category, sport, use or vibe), not
  a generic sale slogan, and must be different from every phrase in already_used_captions.
- Keep text safe for public affiliate post.
- Keep output concise and relevant.
- Use product title and external_url/url_hint_tokens to infer the actual item accurately.
- If generating button_text, keep default style close to "Buy Now".
- If generating metricool_schedule_datetime, choose best posting time between 1 hour from now and within next 24 hours.
${mode === "force_variation" ? "- Generate a clearly different variation than the previous value for each requested key." : ""}
`.trim();

    const parsed = await generateJson<AIPackageFields>({
      prompt,
      // Wide enough for all 6 fields so valid JSON can't truncate mid-object.
      maxTokens: 1024,
      temperature: 0.2
    });

    if (parsed.name) parsed.name = normalizeName(parsed.name);
    if (parsed.Image_editing_text) {
      parsed.Image_editing_text = sanitizeImageText(parsed.Image_editing_text, usedImageTexts);
      usedImageTextsRef.current = [...usedImageTextsRef.current, parsed.Image_editing_text];
    }
    if (parsed.button_text && !parsed.button_text.trim()) parsed.button_text = "Buy Now";
    if (parsed.metricool_schedule_datetime) {
      parsed.metricool_schedule_datetime = clampScheduleWithinWindow(parsed.metricool_schedule_datetime);
    }

    return parsed;
  };

  const pickFieldValue = (payload: AIPackageFields, key: keyof PostPackage): string => {
    switch (key) {
      case "Image_editing_text":
        return payload.Image_editing_text ?? "";
      case "name":
        return payload.name ?? "";
      case "description":
        return payload.description ?? "";
      case "short_description":
        return payload.short_description ?? "";
      case "button_text":
        return payload.button_text ?? "";
      case "metricool_schedule_datetime":
        return payload.metricool_schedule_datetime ?? "";
      default:
        return "";
    }
  };

  const applyGeneratedFields = (index: number, generated: AIPackageFields) => {
    setPackages((prev) => {
      const next = [...prev];
      const current = next[index];
      if (!current) return prev;
      next[index] = {
        ...current,
        Image_editing_text: generated.Image_editing_text ?? current.Image_editing_text,
        name: generated.name ?? current.name,
        description: generated.description ?? current.description,
        short_description: generated.short_description ?? current.short_description,
        button_text: generated.button_text ?? current.button_text
        ,
        metricool_schedule_datetime: generated.metricool_schedule_datetime ?? current.metricool_schedule_datetime
      };
      sessionStorage.setItem("pipeline:post-packages", JSON.stringify(next));
      return next;
    });
    flashSaved();
  };

  const regenField = async (index: number, key: keyof PostPackage) => {
    const product = products[index];
    const pkg = packages[index];
    if (!pkg || !product) return;
    setAiError(null);
    setFieldLoading(index, key, true);
    try {
      if (key === "wordpress_category") {
        const categories = wordpressCategories.length > 0 ? wordpressCategories : await loadWordPressCategories();
        const currentId = pkg.wordpress_category?.id ?? null;
        let nextCategory = await selectCategoryWithAI(product, pkg, categories, "default");

        if (!nextCategory || nextCategory.id === currentId) {
          const secondTry = await selectCategoryWithAI(product, pkg, categories, "force_variation");
          if (secondTry && secondTry.id !== currentId) {
            nextCategory = secondTry;
          }
        }

        if (!nextCategory) {
          throw new Error("No matching WordPress category was selected.");
        }

        patchAt(index, "wordpress_category", nextCategory);
        flashSaved();
        return;
      }

      const currentValue = pkg[key];
      const firstTry = await generateFieldsWithAI(product, pkg, [key], "default");
      let nextValue = pickFieldValue(firstTry, key).trim();
      let generated = firstTry;

      if (!nextValue || nextValue === String(currentValue ?? "").trim()) {
        const secondTry = await generateFieldsWithAI(product, pkg, [key], "force_variation");
        const secondValue = pickFieldValue(secondTry, key).trim();
        if (secondValue && secondValue !== String(currentValue ?? "").trim()) {
          generated = secondTry;
          nextValue = secondValue;
        }
      }

      if (!nextValue || nextValue === String(currentValue ?? "").trim()) {
        throw new Error("Regenerate returned same content. Try again.");
      }

      applyGeneratedFields(index, generated);
    } catch (error) {
      setAiError(getDisplayMessage(error) || "Failed to regenerate field");
    } finally {
      setFieldLoading(index, key, false);
    }
  };

  const regenAll = async () => {
    if (!activePackage || !activeProduct || primaryOpenIndex === null) return;
    const index = primaryOpenIndex;
    setAiError(null);
    setRegeneratingAll(true);
    try {
      let categories = wordpressCategories;
      if (categories.length === 0) {
        try {
          categories = await loadWordPressCategories();
        } catch (error) {
          setCategoriesError(getDisplayMessage(error) || "Failed to load WordPress categories");
          categories = [];
        }
      }
      const generated = await generateFieldsWithAI(activeProduct, activePackage, [
        "Image_editing_text",
        "name",
        "description",
        "short_description",
        "button_text",
        "metricool_schedule_datetime"
      ]);
      const selectedCategory =
        categories.length > 0
          ? await selectCategoryWithAI(
              activeProduct,
              {
                ...activePackage,
                Image_editing_text: generated.Image_editing_text ?? activePackage.Image_editing_text,
                name: generated.name ?? activePackage.name,
                description: generated.description ?? activePackage.description,
                short_description: generated.short_description ?? activePackage.short_description,
                button_text: generated.button_text ?? activePackage.button_text,
                metricool_schedule_datetime: generated.metricool_schedule_datetime ?? activePackage.metricool_schedule_datetime
              },
              categories
            )
          : null;
      setPackages((prev) => {
        const next = [...prev];
        const current = next[index];
        if (!current) return prev;
        next[index] = {
          ...current,
          Image_editing_text: generated.Image_editing_text ?? current.Image_editing_text,
          name: generated.name ?? current.name,
          description: generated.description ?? current.description,
          short_description: generated.short_description ?? current.short_description,
          button_text: generated.button_text ?? current.button_text,
          metricool_schedule_datetime: generated.metricool_schedule_datetime ?? current.metricool_schedule_datetime,
          wordpress_category: selectedCategory ?? current.wordpress_category
        };
        sessionStorage.setItem("pipeline:post-packages", JSON.stringify(next));
        return next;
      });
      flashSaved();
    } catch (error) {
      setAiError(getDisplayMessage(error) || "Failed to regenerate fields");
    } finally {
      setRegeneratingAll(false);
    }
  };

  useEffect(() => {
    const runInitialAI = async () => {
      if (products.length === 0 || packages.length === 0) return;
      if (initialGenerationStartedRef.current) return;
      initialGenerationStartedRef.current = true;
      setAiError(null);
      setRegeneratingAll(true);
      try {
        const nextPackages = [...packages];
        let categories = wordpressCategories;
        if (categories.length === 0) {
          try {
            categories = await loadWordPressCategories();
          } catch (error) {
            setCategoriesError(getDisplayMessage(error) || "Failed to load WordPress categories");
            categories = [];
          }
        }
        const failedProducts: string[] = [];
        // Products are prepared in parallel (capped) and each one commits its own fields and
        // fires its own creative render the moment its text lands, so every card fills in as
        // it finishes instead of the whole page waiting on the slowest product.
        await runWithConcurrency(products, GENERATION_CONCURRENCY, async (product, index) => {
          const current = nextPackages[index];
          if (!product || !current) return;
          let finalPackage = current;
          // Isolate each product: one product's AI/parse failure must not abort generation
          // for the rest, and must not leave its fields stuck on "Generating…" forever.
          try {
            const generated = await generateFieldsWithAI(product, current, [
              "Image_editing_text",
              "name",
              "description",
              "short_description",
              "button_text",
              "metricool_schedule_datetime"
            ]);
            const categoryContext = {
              ...current,
              Image_editing_text: generated.Image_editing_text ?? current.Image_editing_text,
              name: generated.name ?? current.name,
              description: generated.description ?? current.description,
              short_description: generated.short_description ?? current.short_description,
              button_text: generated.button_text ?? current.button_text,
              metricool_schedule_datetime: generated.metricool_schedule_datetime ?? current.metricool_schedule_datetime
            };
            const selectedCategory =
              current.wordpress_category ??
              (categories.length > 0
                ? await selectCategoryWithAI(product, categoryContext, categories)
                : null);
            finalPackage = {
              ...current,
              Image_editing_text: generated.Image_editing_text ?? current.Image_editing_text,
              name: generated.name ?? current.name,
              description: generated.description ?? current.description,
              short_description: generated.short_description ?? current.short_description,
              button_text: generated.button_text ?? current.button_text,
              metricool_schedule_datetime: generated.metricool_schedule_datetime ?? current.metricool_schedule_datetime,
              wordpress_category: selectedCategory ?? current.wordpress_category
            };
            nextPackages[index] = finalPackage;
          } catch (error) {
            // Keep the base (non-AI) values already in nextPackages[index]; the user can
            // Regenerate individual fields. Never block the whole batch on one product.
            console.error(`[package] AI generation failed for "${product.product}"`, error);
            failedProducts.push(product.product);
          }
          patchPackageAt(index, finalPackage);
          // Unblock this product's editor regardless of success, so its fields stop showing
          // "Generating…" — a failed product shows its base details, retryable per field.
          setAiReadyByProduct((prev) => ({ ...prev, [product.id]: true }));
          if (templateId && finalPackage.Image_editing_text?.trim()) {
            await renderPreviewFor(index, product.imageUrl, finalPackage.Image_editing_text, templateId);
          }
        });
        if (failedProducts.length > 0) {
          setAiError(
            `AI content couldn't be generated for ${failedProducts.length} product(s). Their base details are shown — use Regenerate to retry.`
          );
        }
      } catch (error) {
        setAiError(getDisplayMessage(error) || "Failed to generate package content");
      } finally {
        setRegeneratingAll(false);
      }
    };
    void runInitialAI();
  }, [packages, products, wordpressCategories, templateId]);

  const allProductsAiReady = useMemo(() => {
    if (products.length === 0) return false;
    return products.every((product) => aiReadyByProduct[product.id]);
  }, [aiReadyByProduct, products]);

  const activeScheduleParts = useMemo(
    () => parseScheduleParts(activePackage?.metricool_schedule_datetime ?? ""),
    [activePackage?.metricool_schedule_datetime]
  );

  useEffect(() => {
    setScheduleTimeInput(`${activeScheduleParts.hour12}:${activeScheduleParts.minute}`);
  }, [activeScheduleParts.hour12, activeScheduleParts.minute, primaryOpenIndex]);

  // One product's full editor. Rendered inside its accordion row, so every field handler
  // takes the row's own index rather than reading a single "active" product.
  const renderEditor = (index: number) => {
    const product = products[index];
    const pkg = packages[index];
    if (!product || !pkg) return null;
    const ready = isProductReady(index);
    const scheduleParts = parseScheduleParts(pkg.metricool_schedule_datetime ?? "");
    return (
      <div className="space-y-3">
        <div className="flex gap-3">
          <div className="flex-1 space-y-3">
            <Field
              label="Image text"
              value={pkg.Image_editing_text}
              onChange={(value) => patchAt(index, "Image_editing_text", value)}
              onRegenerate={() => void regenField(index, "Image_editing_text")}
              regenerating={Boolean(regeneratingFields[`${index}:Image_editing_text`])}
              initialGenerating={!ready}
            />
            <Field
              label="Post title"
              value={pkg.name}
              onChange={(value) => patchAt(index, "name", value)}
              onRegenerate={() => void regenField(index, "name")}
              regenerating={Boolean(regeneratingFields[`${index}:name`])}
              initialGenerating={!ready}
            />
            <Field
              label="Short description"
              multiline
              value={pkg.short_description}
              onChange={(value) => patchAt(index, "short_description", value)}
              onRegenerate={() => void regenField(index, "short_description")}
              regenerating={Boolean(regeneratingFields[`${index}:short_description`])}
              initialGenerating={!ready}
            />
          </div>
          <div className="card w-1/5 shrink-0 self-start p-2">
            <div className="mb-1 flex items-center justify-between gap-1">
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">Preview</p>
              <button
                type="button"
                className="text-[10px] font-medium text-[#185FA5] disabled:opacity-50"
                disabled={
                  !ready ||
                  !pkg.Image_editing_text?.trim() ||
                  renderPreview[index]?.status === "rendering"
                }
                onClick={() => void runRenderPreview(index)}
                title="Regenerate"
              >
                {renderPreview[index]?.status === "rendering" ? "..." : "↻"}
              </button>
            </div>
            <div>
              {(() => {
                const state = renderPreview[index]?.status ?? "idle";
                if (state === "rendering") {
                  return (
                    <div className="grid aspect-square place-items-center rounded border border-slate-200 bg-slate-50 text-xs text-slate-400">
                      Rendering...
                    </div>
                  );
                }
                if (state === "blank" || state === "error") {
                  return (
                    <div>
                      <div
                        className={`grid aspect-square place-items-center rounded border p-2 text-center text-[10px] font-medium ${
                          state === "blank" ? "border-red-200 bg-red-50 text-red-600" : "border-amber-200 bg-amber-50 text-amber-700"
                        }`}
                      >
                        {state === "blank" ? "Blank render" : "Preview failed"}
                      </div>
                      <p className="mt-1 line-clamp-4 text-[10px] text-slate-500">
                        {renderPreview[index]?.error ?? "Preview failed."}
                      </p>
                    </div>
                  );
                }
                if (pkg.render_preview_href) {
                  const isStale = pkg.render_preview_text !== pkg.Image_editing_text;
                  return (
                    <div>
                      <img
                        src={pkg.render_preview_href}
                        alt="Rendered creative preview"
                        className="w-full rounded border border-slate-200"
                      />
                      {isStale ? (
                        <p className="mt-1 text-[10px] text-amber-600">Text changed — Regenerate.</p>
                      ) : null}
                    </div>
                  );
                }
                return (
                  <div className="grid aspect-square place-items-center rounded border border-slate-200 bg-slate-50 text-xs text-slate-400">
                    {ready ? "No preview yet." : "Waiting..."}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
        <Field
          label="Long Description"
          multiline
          value={pkg.description}
          onChange={(value) => patchAt(index, "description", value)}
          onRegenerate={() => void regenField(index, "description")}
          regenerating={Boolean(regeneratingFields[`${index}:description`])}
          initialGenerating={!ready}
        />
        <Field
          label="Call to action"
          value={pkg.button_text}
          onChange={(value) => patchAt(index, "button_text", value)}
          onRegenerate={() => void regenField(index, "button_text")}
          regenerating={Boolean(regeneratingFields[`${index}:button_text`])}
          initialGenerating={!ready}
        />
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">WordPress category</span>
            <button
              type="button"
              className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
              disabled={!ready || categoriesLoading || Boolean(regeneratingFields[`${index}:wordpress_category`])}
              onClick={() => void regenField(index, "wordpress_category")}
            >
              {regeneratingFields[`${index}:wordpress_category`] ? "Generating..." : "✦ Regenerate"}
            </button>
          </div>
          {!ready ? (
            <div className="field animate-pulse opacity-75">Generating...</div>
          ) : (
            <select
              className="field"
              value={pkg.wordpress_category?.id ?? ""}
              onChange={(event) => {
                const nextId = Number(event.target.value);
                const selected = wordpressCategories.find((category) => category.id === nextId) ?? null;
                patchAt(index, "wordpress_category", selected);
              }}
              disabled={categoriesLoading}
            >
              <option value="">{categoriesLoading ? "Loading categories..." : "Select category"}</option>
              {wordpressCategories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          )}
          {categoriesError ? <p className="mt-2 text-xs text-amber-600">{categoriesError}</p> : null}
        </div>
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wordpress status</span>
          </div>
          {!ready ? (
            <div className="field animate-pulse opacity-75">Generating...</div>
          ) : (
            <select
              className="field"
              value={pkg.status}
              onChange={(event) => patchAt(index, "status", event.target.value as PostPackage["status"])}
            >
              <option value="draft">draft</option>
              <option value="pending">pending</option>
              <option value="private">private</option>
              <option value="publish">publish</option>
            </select>
          )}
        </div>
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metricool schedule date and time</span>
            <button
              type="button"
              className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
              disabled={!ready || Boolean(regeneratingFields[`${index}:metricool_schedule_datetime`])}
              onClick={() => void regenField(index, "metricool_schedule_datetime")}
            >
              {regeneratingFields[`${index}:metricool_schedule_datetime`] ? "Generating..." : "✦ Regenerate"}
            </button>
          </div>
          {!ready ? (
            <div className="field animate-pulse opacity-75">Generating...</div>
          ) : (
            <div className="grid gap-2 sm:grid-cols-4">
              <input
                className="field sm:col-span-2"
                type="date"
                value={scheduleParts.date}
                onChange={(event) =>
                  patchAt(index, 
                    "metricool_schedule_datetime",
                    buildScheduleIso(
                      event.target.value,
                      scheduleParts.hour12,
                      scheduleParts.minute,
                      scheduleParts.period
                    )
                  )
                }
              />
              <input
                className="field"
                list="metricool-time-options"
                value={scheduleTimeInput}
                onChange={(event) => {
                  const nextRaw = event.target.value;
                  setScheduleTimeInput(nextRaw);
                  const match = nextRaw.trim().match(/^(\d{1,2}):(\d{1,2})$/);
                  if (!match) return;
                  const { hour12, minute } = normalizeTypedTime(nextRaw);
                  patchAt(index, 
                    "metricool_schedule_datetime",
                    buildScheduleIso(
                      scheduleParts.date,
                      hour12,
                      minute,
                      scheduleParts.period
                    )
                  );
                }}
                onBlur={() => {
                  const { hour12, minute } = normalizeTypedTime(scheduleTimeInput);
                  setScheduleTimeInput(`${hour12}:${minute}`);
                  patchAt(index, 
                    "metricool_schedule_datetime",
                    buildScheduleIso(
                      scheduleParts.date,
                      hour12,
                      minute,
                      scheduleParts.period
                    )
                  );
                }}
              />
              <datalist id="metricool-time-options">
                {Array.from({ length: 12 }).flatMap((_, index) => {
                  const hour = String(index + 1).padStart(2, "0");
                  const minutes = ["00", "05", "10", "15", "20", "25", "30", "35", "40", "45", "50", "55"];
                  return minutes.map((minute) => (
                    <option key={`${hour}:${minute}`} value={`${hour}:${minute}`} />
                  ));
                })}
              </datalist>
              <select
                className="field"
                value={scheduleParts.period}
                onChange={(event) =>
                  patchAt(index, 
                    "metricool_schedule_datetime",
                    buildScheduleIso(
                      scheduleParts.date,
                      scheduleParts.hour12,
                      scheduleParts.minute,
                      event.target.value as "AM" | "PM"
                    )
                  )
                }
              >
                <option value="AM">AM</option>
                <option value="PM">PM</option>
              </select>
            </div>
          )}
        </div>
        <div className="card p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metricool status</span>
          </div>
          {!ready ? (
            <div className="field animate-pulse opacity-75">Generating...</div>
          ) : (
            <select
              className="field"
              value={pkg.metricool_status}
              onChange={(event) => patchAt(index, "metricool_status", event.target.value as PostPackage["metricool_status"])}
            >
              <option value="draft">draft</option>
              <option value="publish">publish</option>
            </select>
          )}
        </div>

      </div>
    );
  };

  return (
    <>
      <TopNav />
      <FlowStepper active={5} />

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 360px", minHeight: "calc(100vh - var(--nav-h) - var(--stepper-h))" }}>
        <main style={{ padding: 24, borderRight: "1px solid var(--border)", overflowY: "auto", paddingBottom: 90 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
            <h2 style={{ fontSize: 17, fontWeight: 600 }}>Post package editor</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div className={`rounded px-2 py-1 text-xs ${savedTick ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>✓ Saved</div>
              <button
                className="btn btn-sm"
                onClick={() => void regenAll()}
                disabled={regeneratingAll || primaryOpenIndex === null}
                title={primaryOpenIndex === null ? "Open a post to regenerate its fields" : undefined}
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <span style={{ background: "linear-gradient(135deg,#185FA5,#6366F1)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", fontSize: 14 }}>✦</span>
                {regeneratingAll ? "Generating..." : "Regenerate all with AI"}
              </button>
            </div>
          </div>
          {aiError ? <p className="mb-3 text-sm text-red-600">{aiError}</p> : null}

          <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 20 }}>
            AI-generated content for each product. Edit any field inline, or click ✦ to regenerate that field.
          </p>

          <div className="space-y-2">
            {products.map((product, idx) => {
              const isOpen = openIndices.includes(idx);
              const ready = isProductReady(idx);
              const previewState = renderPreview[idx]?.status ?? "idle";
              return (
                <div key={product.id} className="card overflow-hidden p-0">
                  <div className="flex w-full items-center gap-2 pr-2">
                    <button
                      type="button"
                      onClick={() => toggleOpen(idx)}
                      className="flex min-w-0 flex-1 items-center gap-2 px-3 py-2.5 text-left"
                    >
                      <span className={`text-xs text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{product.product}</span>
                      {!ready ? (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                          Generating
                        </span>
                      ) : previewState === "rendering" ? (
                        <span className="flex shrink-0 items-center gap-1 text-[11px] text-slate-400">
                          <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-slate-400" />
                          Rendering
                        </span>
                      ) : previewState === "blank" || previewState === "error" ? (
                        <span className="shrink-0 text-[11px] font-medium text-red-600">Preview issue</span>
                      ) : (
                        <span className="shrink-0 text-[11px] font-medium text-green-600">Ready</span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmDeleteIndex(idx)}
                      // Removing a row shifts every later index; doing that mid-batch would
                      // land in-flight results on the wrong post.
                      disabled={regeneratingAll}
                      className="shrink-0 rounded px-2 py-1 text-sm font-semibold text-red-500 hover:bg-red-50 hover:text-red-700 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-red-500"
                      title={regeneratingAll ? "Wait for generation to finish" : "Remove this post"}
                      aria-label={`Remove ${product.product}`}
                    >
                      ✕
                    </button>
                  </div>
                  {confirmDeleteIndex === idx ? (
                    <div className="flex flex-wrap items-center gap-2 border-t border-red-200 bg-red-50 px-3 py-2">
                      <span className="flex-1 text-xs text-red-700">
                        Remove this post from the run? Its generated content and preview are discarded.
                      </span>
                      <button
                        type="button"
                        className="rounded bg-red-600 px-2 py-1 text-xs font-medium text-white"
                        onClick={() => removeProduct(idx)}
                      >
                        Remove
                      </button>
                      <button
                        type="button"
                        className="rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-600"
                        onClick={() => setConfirmDeleteIndex(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  ) : null}
                  {isOpen ? <div className="border-t border-slate-200 p-3">{renderEditor(idx)}</div> : null}
                </div>
              );
            })}
            {products.length === 0 ? (
              <div className="card p-4 text-sm text-slate-500">No selected products found.</div>
            ) : null}
          </div>

        </main>

        <aside
          style={{
            padding: "20px 28px 20px 22px",
            background: "var(--bg)",
            overflowY: "auto",
            borderLeft: "1px solid var(--border)"
          }}
        >
          <div className="card p-4" style={{ marginBottom: 14 }}>
            <p className="mb-3 text-sm font-semibold">Package summary</p>
              <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Template</span><strong>{templateName ?? templateId ?? "Not selected"}</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">Products</span><strong>{products.length}</strong></div>
              <div className="flex justify-between"><span className="text-slate-500">Platform</span><span>{activeProduct?.platform ?? "-"}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Category</span><span>{activePackage?.wordpress_category?.name ?? "Not selected"}</span></div>
            </div>
          </div>

          <div className="card p-4" style={{ marginBottom: 14 }}>
            <p className="mb-3 text-sm font-semibold">Actions</p>
            <div className="flex flex-col gap-2">
              <Link className="btn-secondary text-center" href="/template">Back to Template</Link>
              <button
                type="button"
                className="btn-primary text-center disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!allProductsAiReady || regeneratingAll}
                onClick={() => router.push("/pipeline")}
              >
                Start Pipeline
              </button>
            </div>
            {!allProductsAiReady ? (
              <p className="mt-2 text-xs text-slate-500">
                AI is generating package fields for all selected products.
              </p>
            ) : null}
          </div>
        </aside>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  multiline,
  onChange,
  onRegenerate,
  regenerating,
  initialGenerating
}: {
  label: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onRegenerate: () => void;
  regenerating?: boolean;
  initialGenerating?: boolean;
}) {
  const displayValue = initialGenerating ? "Generating..." : value;

  return (
    <div className="card p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</span>
        <button type="button" onClick={onRegenerate} disabled={regenerating} className="text-xs font-medium text-[#185FA5] disabled:opacity-50">
          {regenerating ? "Generating..." : "✦ Regenerate"}
        </button>
      </div>
      {multiline ? (
        <textarea
          className={`field min-h-24 ${initialGenerating ? "animate-pulse opacity-75" : ""}`}
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          readOnly={initialGenerating}
        />
      ) : (
        <input
          className={`field ${initialGenerating ? "animate-pulse opacity-75" : ""}`}
          value={displayValue}
          onChange={(event) => onChange(event.target.value)}
          readOnly={initialGenerating}
        />
      )}
      {initialGenerating ? <p className="mt-2 text-xs text-slate-400">Generating...</p> : null}
    </div>
  );
}
