"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getErrorMeta } from "@/lib/api/errors";
import { generateJson } from "@/lib/ai/generate";
import { captureImageAsFile } from "@/lib/media/capture-image";

type SelectedProduct = {
  id: string;
  product: string;
  campaignId?: string;
  imageUrl: string;
  productUrl: string;
  platform: "CJ" | "Impact";
  price: number;
  discount: number;
  imageCandidates?: string[];
};

type StoredPipelineProduct = SelectedProduct & {
  companyName?: string;
};

type RenderformTemplate = {
  identifier: string;
  name: string;
  preview: string;
};

type OptionKey = "wordpress" | "metricool" | "gpt" | "imageEdit";
type StepState = "waiting" | "running" | "done" | "failed";
type ProductRunState = "waiting" | "running" | "retrying" | "done" | "failed";

type ProductRunData = {
  imageUrl?: string;
  renderHref?: string;
  mediaId?: number;
  wpProductId?: string | number;
  wpPermalink?: string;
  wpPosted?: boolean;
  listedAsCreated?: boolean;
};

type PostPackage = {
  Image_editing_text: string;
  name: string;
  type: "external";
  status: "draft" | "pending" | "private" | "publish";
  wordpress_category: {
    id: number;
    name: string;
  } | null;
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
  render_preview_href?: string;
  render_preview_text?: string;
};

type MetricoolPayload = {
  text: string;
  autoPublish: boolean;
  draft: boolean;
  publicationDate: {
    dateTime: string;
    timezone: string;
  };
  media: string[];
  descendants: unknown[];
  facebookData: { type: "POST" };
  firstCommentText: string;
  gmbData: { type: "publication" };
  hasNotReadNotes: boolean;
  instagramData: {
    collaborators: unknown[];
    shareTrialAutomatically: boolean;
    showReelOnFeed: boolean;
    type: "POST";
  };
  linkedinData: {
    previewIncluded: boolean;
    publishImagesAsPDF: boolean;
    type: "POST";
  };
  mediaAltText: Array<null>;
  performanceDashboardIds: unknown[];
  providers: Array<{ network: string }>;
  pinterestData: {
    boardId: string;
    pinTitle: string;
    pinLink: string;
    pinNewFormat: boolean;
  };
  shortener: boolean;
  smartLinkData: { ids: unknown[] };
  threadsData: {
    allowedCountryCodes: unknown[];
    isSpoiler: boolean;
    replyControl: "EVERYONE";
    type: "POST";
  };
  tiktokData: {
    autoAddMusic: boolean;
    commercialContentOwnBrand: boolean;
    commercialContentThirdParty: boolean;
    disableComment: boolean;
    disableDuet: boolean;
    disableStitch: boolean;
    isAigc: boolean;
    photoCoverIndex: number;
    privacyOption: "public_to_everyone";
  };
  twitterData: {
    tags: unknown[];
    type: "POST";
  };
};

type PinterestBoard = {
  id: string;
  name: string;
};

type MetricoolUploadResponse = {
  raw_text?: string;
};

type WordPressProductPayload = Omit<
  PostPackage,
  "Image_editing_text" | "metricool_schedule_datetime" | "metricool_status" | "wordpress_category"
> & {
  categories?: Array<{ id: number }>;
};

const PIPELINE_STEPS = [
  "Create post package",
  "Download and edit image",
  "Create WordPress post",
  "Schedule to Metricool"
];
const METRICOOL_TEXT_LIMIT = 500;
const RENDER_RETRY_DELAYS_MS = [2000, 5000, 12000];
// Automatic internal per-product retry (resumes from the failed step instead of
// re-running the whole product) so a transient failure never surfaces to the user
// if simply re-attempting would have worked — mirrors "run the same flow again".
const PRODUCT_RETRY_DELAYS_MS = [2000, 5000, 12000];
// Last-resort image when a product's source image (and all its candidates) are
// unreachable during pre-flight. Guarantees the render/publish step still completes
// instead of dropping the product from the run.
const PLACEHOLDER_IMAGE_URL = "https://placehold.co/800x800/eeeeee/999999.png?text=Image+Unavailable";

function inferImageExtension(contentType: string | null): string {
  switch ((contentType ?? "").toLowerCase()) {
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    case "image/gif":
      return "gif";
    default:
      return "jpg";
  }
}

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isRetryableRenderError(error: unknown): boolean {
  const meta = getErrorMeta(error);
  return meta.code === "RENDER_TIMEOUT" || meta.retryable || (meta.status !== undefined && meta.status >= 500);
}

async function checkImageUrlHealth(url: string): Promise<boolean> {
  if (!url) return false;
  try {
    const response = await fetch(`/api/url-health?url=${encodeURIComponent(url)}`);
    const payload = (await response.json()) as { ok?: boolean };
    return payload.ok === true;
  } catch {
    return false;
  }
}

/**
 * Pre-flight: verify every selected product's source image is reachable before the run
 * starts. A dead image is never dropped from the run — it is repaired in place by trying
 * carried alternate images (imageCandidates), then falling back to a bundled placeholder
 * so the render/publish step always has something valid to work with.
 */
async function validateAndRepairImages(
  products: StoredPipelineProduct[],
  onRepair: (product: StoredPipelineProduct, source: "candidate" | "placeholder") => void
): Promise<StoredPipelineProduct[]> {
  const repaired = await Promise.all(
    products.map(async (product): Promise<StoredPipelineProduct> => {
      const primaryOk = await checkImageUrlHealth(product.imageUrl);
      if (primaryOk) return product;

      const candidates = (product.imageCandidates ?? []).filter((url) => url && url !== product.imageUrl);
      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const candidateOk = await checkImageUrlHealth(candidate);
        if (candidateOk) {
          onRepair(product, "candidate");
          return { ...product, imageUrl: candidate };
        }
      }

      onRepair(product, "placeholder");
      return { ...product, imageUrl: PLACEHOLDER_IMAGE_URL };
    })
  );
  return repaired;
}

function normalizeForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 2);
}

function normalizeTagToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function extractTagsFromText(text: string): string[] {
  const matches = text.match(/#[A-Za-z0-9_]+/g) ?? [];
  const seen = new Set<string>();
  const tags: string[] = [];
  matches.forEach((raw) => {
    const normalized = normalizeTagToken(raw);
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    tags.push(`#${normalized}`);
  });
  return tags;
}

function tagSignature(tags: string[]): string {
  return tags.map((tag) => normalizeTagToken(tag)).filter(Boolean).sort().join("|");
}

function tagOverlapScore(a: string[], b: string[]): number {
  const aSet = new Set(a.map((tag) => normalizeTagToken(tag)).filter(Boolean));
  const bSet = new Set(b.map((tag) => normalizeTagToken(tag)).filter(Boolean));
  if (aSet.size === 0 || bSet.size === 0) return 0;
  let intersection = 0;
  aSet.forEach((token) => {
    if (bSet.has(token)) intersection += 1;
  });
  const union = new Set([...aSet, ...bSet]).size;
  return union === 0 ? 0 : intersection / union;
}

function removeHashtagLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trim();
}

function splitWords(value: string): string[] {
  return normalizeForMatch(value)
    .split(" ")
    .filter((token) => token.length >= 3);
}

function enforceMetricoolTextLimit(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const buyNowLine = lines.find((line) => line.toLowerCase().startsWith("buy now:")) ?? "";
  const hashtagLine = lines.find((line) => line.startsWith("#")) ?? "";
  const body = lines
    .filter((line) => line !== buyNowLine && line !== hashtagLine)
    .join(" ")
    .trim();

  const trailingLines = [buyNowLine, hashtagLine].filter(Boolean).join("\n");
  const reservedLength = trailingLines.length > 0 ? trailingLines.length + 1 : 0;
  const bodyLimit = Math.max(0, maxLength - reservedLength);

  const trimAtSentenceBoundary = (value: string, limit: number): string => {
    if (value.length <= limit) return value.trim();
    const slice = value.slice(0, limit);
    const punctuationIndexes = [
      slice.lastIndexOf(". "),
      slice.lastIndexOf("! "),
      slice.lastIndexOf("? "),
      slice.lastIndexOf("."),
      slice.lastIndexOf("!"),
      slice.lastIndexOf("?")
    ];
    const bestIndex = Math.max(...punctuationIndexes);
    if (bestIndex >= Math.floor(limit * 0.55)) {
      return slice.slice(0, bestIndex + 1).trim();
    }
    return slice.trim();
  };

  const trimmedBody = trimAtSentenceBoundary(body, bodyLimit);
  const rebuilt = [trimmedBody, trailingLines].filter(Boolean).join("\n").trim();
  if (rebuilt.length <= maxLength) return rebuilt;
  return rebuilt.slice(0, maxLength).trim();
}

function buildFallbackTags(
  product: StoredPipelineProduct,
  postPackage: PostPackage,
  bannedSignatures: string[]
): string[] {
  const pool = [
    ...splitWords(product.product).slice(0, 4),
    ...splitWords(product.companyName ?? "").slice(0, 2),
    ...splitWords(postPackage.short_description).slice(0, 2),
    "affiliate",
    "shopping",
    product.platform.toLowerCase(),
    "deals",
    "sale"
  ];

  const uniquePool = Array.from(new Set(pool.map((item) => normalizeTagToken(item)).filter((item) => item.length >= 3)));
  const tags: string[] = [];
  uniquePool.forEach((token) => {
    if (tags.length < 6) tags.push(`#${token}`);
  });
  if (tags.length < 4) {
    ["shopnow", "trending", "musthave", "newarrival"].forEach((extra) => {
      if (tags.length < 6 && !tags.includes(`#${extra}`)) tags.push(`#${extra}`);
    });
  }

  let finalTags = tags.slice(0, Math.min(6, Math.max(4, tags.length)));
  const fallbackAlternates = ["todaydeals", "smartbuy", "bestfinds", "onlineoffers", "discountfinds", "dailydeals"];
  let alternateIndex = 0;
  while (bannedSignatures.includes(tagSignature(finalTags)) && alternateIndex < fallbackAlternates.length) {
    finalTags = [...finalTags.slice(1), `#${fallbackAlternates[alternateIndex]}`];
    finalTags = Array.from(new Set(finalTags.map((tag) => `#${normalizeTagToken(tag)}`))).slice(0, 6);
    alternateIndex += 1;
  }
  return finalTags.slice(0, 6);
}

function pickBestPinterestBoard(
  productTitle: string,
  companyName: string | undefined,
  boards: PinterestBoard[]
): { board: PinterestBoard; reason: "title" | "company" | "fallback" } | null {
  if (boards.length === 0) return null;

  const titleNormalized = normalizeForMatch(productTitle);
  const titleTokens = tokenize(productTitle).slice(0, 5);
  const companyNormalized = normalizeForMatch(companyName ?? "");
  const companyTokens = tokenize(companyName ?? "");

  const scoreBoard = (boardName: string) => {
    const boardNormalized = normalizeForMatch(boardName);
    let titleScore = 0;
    let companyScore = 0;

    if (boardNormalized === titleNormalized) titleScore += 1000;
    if (titleNormalized.includes(boardNormalized) || boardNormalized.includes(titleNormalized)) titleScore += 350;
    titleTokens.forEach((token) => {
      if (boardNormalized === token) titleScore += 260;
      else if (boardNormalized.startsWith(token)) titleScore += 180;
      else if (boardNormalized.includes(token)) titleScore += 120;
    });

    if (companyNormalized) {
      if (boardNormalized === companyNormalized) companyScore += 900;
      if (companyNormalized.includes(boardNormalized) || boardNormalized.includes(companyNormalized)) companyScore += 300;
      companyTokens.forEach((token) => {
        if (boardNormalized === token) companyScore += 220;
        else if (boardNormalized.startsWith(token)) companyScore += 140;
        else if (boardNormalized.includes(token)) companyScore += 100;
      });
    }

    return { titleScore, companyScore, total: titleScore + companyScore };
  };

  const scored = boards
    .map((board) => ({ board, ...scoreBoard(board.name) }))
    .sort((a, b) => b.total - a.total);

  const best = scored[0];
  if (!best || best.total <= 0) {
    return { board: boards[0], reason: "fallback" };
  }
  if (best.titleScore > 0) {
    return { board: best.board, reason: "title" };
  }
  if (best.companyScore > 0) {
    return { board: best.board, reason: "company" };
  }
  return { board: boards[0], reason: "fallback" };
}

export default function PipelinePage() {
  const [selectedProducts, setSelectedProducts] = useState<StoredPipelineProduct[]>([]);
  const [productReady, setProductReady] = useState<Record<string, boolean>>({});
  const [productStates, setProductStates] = useState<Record<string, ProductRunState>>({});
  const [productStepStates, setProductStepStates] = useState<Record<string, StepState[]>>({});
  const [accordionOpen, setAccordionOpen] = useState<Record<string, boolean>>({});
  const [templates, setTemplates] = useState<RenderformTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [selectedTemplateNameFromSession, setSelectedTemplateNameFromSession] = useState<string | null>(null);
  const [pipelineStarted, setPipelineStarted] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [currentProductLabel, setCurrentProductLabel] = useState<string>("No active product");
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [pipelineRetryable, setPipelineRetryable] = useState(false);
  const [createdWpProducts, setCreatedWpProducts] = useState<Array<{ productId: string | number; mediaId: number; productName: string }>>([]);
  const [logLines, setLogLines] = useState<Array<{ tone: "info" | "ok" | "warn" | "err"; text: string }>>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [productRetryCount, setProductRetryCount] = useState<Record<string, number>>({});
  const [preflightRunning, setPreflightRunning] = useState(false);
  const recentHashtagSetsRef = useRef<string[][]>([]);
  const pinterestBoardsRef = useRef<PinterestBoard[]>([]);
  // Per-product progress (rendered image href, uploaded WP media id, created WP post id).
  // Preserved across an internal auto-retry so resuming a failed product never re-runs an
  // already-completed step — critical because WP post creation is not idempotent.
  const productRunDataRef = useRef<Record<string, ProductRunData>>({});
  const [options, setOptions] = useState<Record<OptionKey, boolean>>({
    wordpress: true,
    metricool: true,
    gpt: true,
    imageEdit: true
  });

  useEffect(() => {
    const raw = sessionStorage.getItem("pipeline:selected-products");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as StoredPipelineProduct[];
      setSelectedProducts(parsed);
      const readyMap: Record<string, boolean> = {};
      const stateMap: Record<string, ProductRunState> = {};
      const stepMap: Record<string, StepState[]> = {};
      const openMap: Record<string, boolean> = {};
      parsed.forEach((product, index) => {
        readyMap[product.id] = true;
        stateMap[product.id] = "waiting";
        stepMap[product.id] = ["waiting", "waiting", "waiting", "waiting"];
        openMap[product.id] = index === 0;
      });
      setProductReady(readyMap);
      setProductStates(stateMap);
      setProductStepStates(stepMap);
      setAccordionOpen(openMap);
      setSelectedTemplateNameFromSession(sessionStorage.getItem("pipeline:selected-template-name"));
    } catch {
      setSelectedProducts([]);
    }
  }, []);

  useEffect(() => {
    const fetchTemplates = async () => {
      setLoadingTemplates(true);
      setTemplatesError(null);
      try {
        const response = await http.get("/api/v1/renderform/templates");
        const data = unwrapEnvelope<RenderformTemplate[]>(response.data);
        setTemplates(data);
        const sessionSelected = sessionStorage.getItem("pipeline:selected-template");
        if (sessionSelected && data.some((template) => template.identifier === sessionSelected)) {
          setSelectedTemplateId(sessionSelected);
        } else if (data.length > 0) {
          setSelectedTemplateId(data[0].identifier);
        }
      } catch (error) {
        setTemplatesError(getErrorMeta(error).message || "Failed to fetch templates");
      } finally {
        setLoadingTemplates(false);
      }
    };
    void fetchTemplates();
  }, []);

  useEffect(() => {
    if (!pipelineRunning) return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [pipelineRunning]);

  const pushLog = (tone: "info" | "ok" | "warn" | "err", text: string) => {
    setLogLines((prev) => [...prev, { tone, text }]);
  };

  const readyCount = useMemo(
    () => Object.values(productReady).filter(Boolean).length,
    [productReady]
  );

  const selectedTemplateName = useMemo(
    () => templates.find((template) => template.identifier === selectedTemplateId)?.name ?? selectedTemplateNameFromSession,
    [selectedTemplateId, selectedTemplateNameFromSession, templates]
  );

  const totalStepCount = useMemo(() => selectedProducts.length * PIPELINE_STEPS.length, [selectedProducts.length]);
  const doneStepCount = useMemo(() => Object.values(productStepStates).flat().filter((state) => state === "done").length, [productStepStates]);
  const errorCount = useMemo(() => Object.values(productStates).filter((state) => state === "failed").length, [productStates]);
  const completedCount = useMemo(() => Object.values(productStates).filter((state) => state === "done").length, [productStates]);
  const overallPercent = totalStepCount === 0 ? 0 : Math.round((doneStepCount / totalStepCount) * 100);

  const toggleOption = (key: OptionKey) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const setProductStep = (productId: string, stepIndex: number, state: StepState) => {
    setProductStepStates((prev) => {
      const existing = prev[productId] ?? ["waiting", "waiting", "waiting", "waiting"];
      const next = [...existing];
      next[stepIndex] = state;
      return { ...prev, [productId]: next };
    });
  };

  const setProductState = (productId: string, state: ProductRunState) => {
    setProductStates((prev) => ({ ...prev, [productId]: state }));
  };

  const resetProductSteps = (productId: string) => {
    setProductStepStates((prev) => ({ ...prev, [productId]: ["waiting", "waiting", "waiting", "waiting"] }));
  };

  const toPriceString = (value: number) => value.toFixed(2);

  const createBasePostPackage = (product: SelectedProduct): PostPackage => {
    const salePrice = product.discount > 0 ? product.price : 0;
    const regularPrice = product.discount > 0
      ? product.price / (1 - product.discount / 100)
      : product.price;
    return {
      Image_editing_text: "Keyname_Value",
      name: product.product || "Keyname_Value",
      type: "external",
      status: "publish",
      wordpress_category: null,
      metricool_schedule_datetime: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19),
      metricool_status: "publish",
      featured: true,
      catalog_visibility: "visible",
      description: "Keyname_Value",
      short_description: "Keyname_Value",
      external_url: product.productUrl || "Keyname_Value",
      button_text: "Buy Now",
      regular_price: toPriceString(regularPrice),
      sale_price: salePrice > 0 ? toPriceString(salePrice) : "",
      images: [{ id: 0 }],
      meta_data: [{ key: "vendor", value: "Keyname_Value" }]
    };
  };

  const getStoredPackagesByProductId = (products: StoredPipelineProduct[]) => {
    const map: Record<string, PostPackage> = {};
    try {
      const raw = sessionStorage.getItem("pipeline:post-packages");
      if (!raw) return map;
      const parsed = JSON.parse(raw) as PostPackage[];
      products.forEach((product, index) => {
        const fromStorage = parsed[index];
        if (fromStorage) {
          map[product.id] = fromStorage;
        }
      });
    } catch {
      // ignore and use fallbacks
    }
    return map;
  };

  const buildWordPressProductPayload = (postPackage: PostPackage, mediaId: number): WordPressProductPayload => ({
    name: postPackage.name,
    type: postPackage.type,
    status: postPackage.status,
    featured: postPackage.featured,
    catalog_visibility: postPackage.catalog_visibility,
    description: postPackage.description,
    short_description: postPackage.short_description,
    external_url: postPackage.external_url,
    button_text: postPackage.button_text,
    regular_price: postPackage.regular_price,
    sale_price: postPackage.sale_price,
    categories: postPackage.wordpress_category ? [{ id: postPackage.wordpress_category.id }] : [],
    images: [{ id: mediaId }],
    meta_data: postPackage.meta_data
  });

  const generateMetricoolText = async (
    product: StoredPipelineProduct,
    postPackage: PostPackage,
    permalink: string
  ): Promise<string> => {
    const bannedSignatures = recentHashtagSetsRef.current.map((set) => tagSignature(set));
    const fallbackTagsArray = buildFallbackTags(product, postPackage, bannedSignatures);
    const fallbackTags = fallbackTagsArray.join(" ");

    const ensureCaptionShape = (rawText: string): string => {
      const cleanedBody = removeHashtagLines(rawText).trim();
      let withBuy = cleanedBody.includes(`Buy now: ${permalink}`)
        ? cleanedBody
        : `${cleanedBody}\nBuy now: ${permalink}`.trim();

      let tags = extractTagsFromText(rawText);
      if (tags.length < 4) {
        fallbackTagsArray.forEach((tag) => {
          if (tags.length < 6 && !tags.includes(tag)) tags.push(tag);
        });
      }
      if (tags.length > 6) tags = tags.slice(0, 6);
      if (tags.length < 4) tags = fallbackTagsArray.slice(0, 4);

      const finalText = `${withBuy}\n${tags.join(" ")}`.trim();
      recentHashtagSetsRef.current = [...recentHashtagSetsRef.current.slice(-9), tags];
      return finalText;
    };

    if (!options.gpt) {
      return ensureCaptionShape(`${postPackage.description}\n\nBuy now: ${permalink}\n${fallbackTags}`);
    }

    const requestTextFromAi = async (
      variation: "default" | "force_variation",
      enforceShort: boolean
    ): Promise<string | null> => {
      const prompt = `
You write social media caption text for affiliate product posts.
Return ONLY strict JSON: {"text":"string"}

Rules:
- ALWAYS write in English, even when the product title or description is in another
  language. Keep brand, model and team names as-is.
- 2 to 4 lines max.
- Concise, engaging, no hashtags spam.
- Mention key product benefit naturally.
- Total character count MUST be <= ${METRICOOL_TEXT_LIMIT} characters.
- Final line MUST be exactly: Buy now: ${permalink}
- Add exactly one hashtag line after Buy now.
- Hashtag line MUST contain 4 to 6 hashtags.
- Hashtags must be relevant and specific to product category/brand/use-case.
- Avoid repeating generic fixed hashtag sets.
- Do not reuse these previous hashtag sets from current run: ${JSON.stringify(bannedSignatures)}
${variation === "force_variation" ? "- IMPORTANT: use a clearly different hashtag set than previous outputs." : ""}
${enforceShort ? `- IMPORTANT: previous output exceeded ${METRICOOL_TEXT_LIMIT} chars. Keep this one significantly shorter and still meaningful.` : ""}

Context:
{
  "product": ${JSON.stringify(product.product)},
  "company": ${JSON.stringify(product.companyName ?? "")},
  "platform": ${JSON.stringify(product.platform)},
  "description": ${JSON.stringify(postPackage.description)},
  "short_description": ${JSON.stringify(postPackage.short_description)},
  "button_text": ${JSON.stringify(postPackage.button_text)},
  "price": ${JSON.stringify(postPackage.sale_price || postPackage.regular_price)}
}
`.trim();

      try {
        const parsed = await generateJson<{ text?: string }>({
          prompt,
          maxTokens: 512,
          temperature: 0.85
        });
        return parsed.text?.trim() ?? null;
      } catch {
        // Caption AI is best-effort; caller falls back to a templated caption.
        return null;
      }
    };

    const firstCandidate = await requestTextFromAi("default", false);
    if (!firstCandidate) {
      return ensureCaptionShape(`${postPackage.description}\n\nBuy now: ${permalink}\n${fallbackTags}`);
    }

    const firstTags = extractTagsFromText(firstCandidate);
    const tooSimilar = recentHashtagSetsRef.current.some((previous) => tagOverlapScore(firstTags, previous) >= 0.8);
    const weakTags = firstTags.length < 4 || firstTags.length > 6;

    const tooLong = ensureCaptionShape(firstCandidate).length > METRICOOL_TEXT_LIMIT;
    if (tooSimilar || weakTags || tooLong) {
      const secondCandidate = await requestTextFromAi("force_variation", tooLong);
      if (secondCandidate) {
        const secondTags = extractTagsFromText(secondCandidate);
        const stillTooSimilar = recentHashtagSetsRef.current.some((previous) => tagOverlapScore(secondTags, previous) >= 0.8);
        const secondNormalized = ensureCaptionShape(secondCandidate);
        const secondTooLong = secondNormalized.length > METRICOOL_TEXT_LIMIT;
        if (!stillTooSimilar && secondTags.length >= 4 && secondTags.length <= 6 && !secondTooLong) {
          return secondNormalized;
        }
      }
    }
    const firstNormalized = ensureCaptionShape(firstCandidate);
    if (firstNormalized.length > METRICOOL_TEXT_LIMIT) {
      return ensureCaptionShape(`${postPackage.short_description}\nBuy now: ${permalink}\n${fallbackTags}`);
    }
    return firstNormalized;
  };

  const buildMetricoolPayload = (
    mediaUrl: string,
    text: string,
    scheduleDateTime: string,
    metricoolStatus: "draft" | "publish",
    pinterestBoardId: string,
    pinTitle: string,
    pinLink: string
  ): MetricoolPayload => {
    const fallback = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
    const dateTime = (scheduleDateTime || fallback).replace(" ", "T").slice(0, 19);
    const draft = metricoolStatus === "draft";
    const boundedText = enforceMetricoolTextLimit(text, METRICOOL_TEXT_LIMIT);
    return {
      text: boundedText,
      autoPublish: true,
      draft,
      publicationDate: {
        dateTime,
        timezone: "America/Denver"
      },
      media: [mediaUrl],
      descendants: [],
      facebookData: { type: "POST" },
      firstCommentText: "",
      gmbData: { type: "publication" },
      hasNotReadNotes: false,
      instagramData: {
        collaborators: [],
        shareTrialAutomatically: false,
        showReelOnFeed: true,
        type: "POST"
      },
      linkedinData: {
        previewIncluded: true,
        publishImagesAsPDF: false,
        type: "POST"
      },
      mediaAltText: [null],
      performanceDashboardIds: [],
      providers: [
        { network: "twitter" },
        { network: "pinterest" },
        { network: "facebook" },
        { network: "instagram" },
        { network: "threads" },
        { network: "linkedin" },
        { network: "gmb" },
        { network: "tiktok" }
      ],
      pinterestData: {
        boardId: pinterestBoardId,
        pinTitle,
        pinLink,
        pinNewFormat: false
      },
      shortener: false,
      smartLinkData: { ids: [] },
      threadsData: {
        allowedCountryCodes: [],
        isSpoiler: false,
        replyControl: "EVERYONE",
        type: "POST"
      },
      tiktokData: {
        autoAddMusic: false,
        commercialContentOwnBrand: false,
        commercialContentThirdParty: false,
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
        isAigc: false,
        photoCoverIndex: 0,
        privacyOption: "public_to_everyone"
      },
      twitterData: {
        tags: [],
        type: "POST"
      }
    };
  };

  // Single, non-retrying attempt at a product's full flow. Resumes from whatever step
  // productRunDataRef already has cached, so re-invoking this after a failure never
  // re-renders an image or re-creates a WordPress post that already succeeded.
  const attemptProductOnce = async (
    product: StoredPipelineProduct,
    basePostPackage: PostPackage,
    pinterestBoards: PinterestBoard[]
  ): Promise<void> => {
    const runData: ProductRunData = productRunDataRef.current[product.id] ?? {};
    // Reuse the render already approved on the Post Package preview step, as long as the
    // caption hasn't changed since — an edit after previewing means the baked-in text would
    // no longer match, so that case falls through and renders fresh below instead.
    if (
      !runData.renderHref &&
      basePostPackage.render_preview_href &&
      basePostPackage.render_preview_text === basePostPackage.Image_editing_text
    ) {
      runData.renderHref = basePostPackage.render_preview_href;
    }
    productRunDataRef.current[product.id] = runData;

    setProductStep(product.id, 0, "running");
    await Promise.resolve();
    setProductStep(product.id, 0, "done");

    setProductStep(product.id, 1, "running");
    let renderHref = runData.renderHref;
    if (!renderHref) {
      let renderResponse;
      for (let attempt = 0; attempt < RENDER_RETRY_DELAYS_MS.length + 1; attempt += 1) {
        try {
          renderResponse = await http.post("/api/v1/renderform/render", {
            template: selectedTemplateId,
            titleText: basePostPackage.Image_editing_text,
            imageSrc: product.imageUrl,
            extraData: {}
          });
          break;
        } catch (error) {
          const meta = getErrorMeta(error);
          // The photo's CDN may be blocking RenderForm's server-side fetch (Cloudflare and
          // similar bot protection) while the browser can load it fine — try reading those
          // bytes back out of the browser and uploading them directly before giving up.
          // Silent: no retry log, no UI change, only the outcome (success or the same error
          // the product would have failed with anyway).
          if (meta.code === "IMAGE_INVALID_OR_BLANK") {
            const file = await captureImageAsFile(product.imageUrl);
            if (file) {
              try {
                const uploadForm = new FormData();
                // Guarded by the pre-flight check before the pipeline starts (selectedTemplateId
                // must be set to reach this render step at all).
                uploadForm.append("template", selectedTemplateId ?? "");
                uploadForm.append("titleText", basePostPackage.Image_editing_text);
                uploadForm.append("image", file);
                renderResponse = await http.post("/api/v1/renderform/render/upload", uploadForm, {
                  headers: { "Content-Type": "multipart/form-data" }
                });
                break;
              } catch {
                // Upload path failed too; fall through to the original error below.
              }
            }
            throw error;
          }
          const isFinalAttempt = attempt >= RENDER_RETRY_DELAYS_MS.length;
          if (!isRetryableRenderError(error) || isFinalAttempt) {
            throw error;
          }
          const delayMs = RENDER_RETRY_DELAYS_MS[attempt];
          const errorMessage = getErrorMeta(error).message;
          pushLog(
            "warn",
            `[${product.product}] image editing attempt ${attempt + 1} failed: ${errorMessage}. Retrying ${attempt + 2}/${RENDER_RETRY_DELAYS_MS.length + 1} in ${Math.round(delayMs / 1000)}s`
          );
          await wait(delayMs);
        }
      }
      if (!renderResponse) {
        throw new Error("Render response was not returned.");
      }
      const renderData = unwrapEnvelope<{ href: string }>(renderResponse.data);
      renderHref = renderData.href;
      runData.renderHref = renderHref;
    }
    setProductStep(product.id, 1, "done");
    pushLog("ok", `[${product.product}] image rendered`);

    setProductStep(product.id, 2, "running");
    let mediaId = runData.mediaId;
    let wpProductId = runData.wpProductId;
    let wpPermalink = runData.wpPermalink ?? "";
    if (!runData.wpPosted) {
      const mediaForm = new FormData();
      mediaForm.append("file", new Blob([]), "");
      mediaForm.append("image_url", renderHref);
      const mediaUploadResponse = await http.post("/api/v1/wordpress/media/upload", mediaForm, {
        headers: {
          "Content-Type": "multipart/form-data"
        }
      });
      const mediaUploadData = unwrapEnvelope<{ id: number; guid?: { rendered?: string }; permalink_template?: string }>(mediaUploadResponse.data);

      const postPackagePayload = buildWordPressProductPayload(basePostPackage, mediaUploadData.id);

      const productCreateResponse = await http.post("/api/v1/wordpress/products", postPackagePayload);
      const wpProductData = unwrapEnvelope<{ id?: string | number; permalink?: string }>(productCreateResponse.data);

      mediaId = mediaUploadData.id;
      wpProductId = wpProductData.id ?? "N/A";
      wpPermalink = wpProductData.permalink ?? "";
      runData.mediaId = mediaId;
      runData.wpProductId = wpProductId;
      runData.wpPermalink = wpPermalink;
      runData.wpPosted = true;
    }
    setProductStep(product.id, 2, "done");
    pushLog("ok", `[${product.product}] wordpress product created`);

    setProductStep(product.id, 3, "running");
    if (options.metricool) {
      pushLog("info", `[${product.product}] fetching rendered image for Metricool upload`);
      const renderImageResponse = await fetch(renderHref);
      if (!renderImageResponse.ok) {
        throw new Error(`Failed to fetch rendered image for Metricool upload (${renderImageResponse.status})`);
      }
      const renderImageContentType = renderImageResponse.headers.get("content-type");
      if (!renderImageContentType?.startsWith("image/")) {
        throw new Error("Rendered asset is not a valid image for Metricool upload.");
      }
      const renderImageBlob = await renderImageResponse.blob();
      pushLog("ok", `[${product.product}] rendered image fetched`);

      const metricoolUploadForm = new FormData();
      metricoolUploadForm.append(
        "picture",
        renderImageBlob,
        `metricool-${product.id}.${inferImageExtension(renderImageContentType)}`
      );
      const metricoolUploadResponse = await http.post(
        "/api/v1/metricool/upload",
        metricoolUploadForm,
        {
          params: { userId: "1981059", blogId: "3410405" },
          headers: {
            "Content-Type": "multipart/form-data"
          }
        }
      );
      const metricoolUploadData = unwrapEnvelope<MetricoolUploadResponse>(metricoolUploadResponse.data);
      const mediaUrl = metricoolUploadData.raw_text?.trim() ?? "";
      if (!mediaUrl) {
        pushLog("err", `[${product.product}] Metricool upload failed: no hosted media URL returned`);
        throw new Error("Metricool upload did not return a hosted media URL.");
      }
      pushLog("ok", `[${product.product}] Metricool media uploaded`);
      const metricoolText = await generateMetricoolText(product, basePostPackage, wpPermalink);
      const boardMatch = pickBestPinterestBoard(product.product, product.companyName, pinterestBoards);
      if (!boardMatch) {
        throw new Error("No Pinterest boards available to post.");
      }
      if (boardMatch.reason === "fallback") {
        pushLog("warn", `[${product.product}] Pinterest board fallback used: ${boardMatch.board.name} (${boardMatch.board.id})`);
      } else {
        pushLog("ok", `[${product.product}] Pinterest board matched by ${boardMatch.reason}: ${boardMatch.board.name} (${boardMatch.board.id})`);
      }
      const metricoolPayload = buildMetricoolPayload(
        mediaUrl,
        metricoolText,
        basePostPackage.metricool_schedule_datetime,
        basePostPackage.metricool_status,
        boardMatch.board.id,
        basePostPackage.name,
        wpPermalink
      );
      await http.post(
        "/api/v1/metricool/scheduler/posts",
        metricoolPayload,
        { params: { userId: "1981059", blogId: "3410405" } }
      );
    }
    setProductStep(product.id, 3, "done");
    setProductState(product.id, "done");
    if (!runData.listedAsCreated) {
      runData.listedAsCreated = true;
      setCreatedWpProducts((prev) => [...prev, { productId: wpProductId ?? "N/A", mediaId: mediaId ?? 0, productName: product.product }]);
    }
    pushLog("ok", `[${product.product}] completed`);
  };

  // Runs one product to completion, automatically re-attempting internally (resuming from
  // whatever step already succeeded) before ever surfacing a failure — mirroring what
  // manually re-running the same flow already fixes today. Never throws: the batch loop
  // keeps going regardless of this product's outcome.
  const processProduct = async (
    product: StoredPipelineProduct,
    basePostPackage: PostPackage,
    pinterestBoards: PinterestBoard[]
  ): Promise<boolean> => {
    resetProductSteps(product.id);
    setProductState(product.id, "running");
    setProductRetryCount((prev) => ({ ...prev, [product.id]: 0 }));
    setAccordionOpen((prev) => ({ ...prev, [product.id]: true }));
    setCurrentProductLabel(product.product);
    pushLog("info", `[${product.product}] starting`);

    const maxAttempts = PRODUCT_RETRY_DELAYS_MS.length + 1;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        if (attempt > 0) {
          setProductState(product.id, "retrying");
          setProductRetryCount((prev) => ({ ...prev, [product.id]: attempt }));
          pushLog("info", `[${product.product}] auto-retrying (attempt ${attempt + 1}/${maxAttempts})`);
        }
        await attemptProductOnce(product, basePostPackage, pinterestBoards);
        return true;
      } catch (error) {
        const meta = getErrorMeta(error);
        const isFinalAttempt = attempt >= maxAttempts - 1;
        if (!isFinalAttempt) {
          const delayMs = PRODUCT_RETRY_DELAYS_MS[attempt];
          pushLog(
            "warn",
            `[${product.product}] attempt ${attempt + 1} failed${meta.code ? ` (${meta.code})` : ""}: ${meta.message}. Retrying in ${Math.round(delayMs / 1000)}s`
          );
          await wait(delayMs);
          continue;
        }
        setProductState(product.id, "failed");
        setProductStepStates((prev) => {
          const current = prev[product.id] ?? ["waiting", "waiting", "waiting", "waiting"];
          const next = current.map((step) => (step === "running" ? "failed" : step)) as StepState[];
          return { ...prev, [product.id]: next };
        });
        const message = meta.message || "Pipeline failed";
        pushLog(
          "err",
          `[${product.product}] failed${meta.step ? ` at ${meta.step}` : ""}${meta.code ? ` (${meta.code})` : ""} after ${maxAttempts} attempts: ${message}`
        );
        return false;
      }
    }
    return false;
  };

  const runPipeline = async () => {
    if (!selectedTemplateId) {
      setPipelineError("Please select a template");
      return;
    }
    let readyProducts = selectedProducts.filter((product) => productReady[product.id]);
    if (readyProducts.length === 0) {
      setPipelineError("Mark at least one product as Ready");
      return;
    }

    setPipelineError(null);
    setPipelineRetryable(false);
    setPipelineStarted(true);
    setPipelineRunning(true);
    setElapsedSeconds(0);
    setCreatedWpProducts([]);
    setLogLines([]);
    recentHashtagSetsRef.current = [];
    productRunDataRef.current = {};
    pushLog("info", `Pipeline started for ${readyProducts.length} products`);

    setPreflightRunning(true);
    pushLog("info", "Validating source images before starting...");
    readyProducts = await validateAndRepairImages(readyProducts, (product, source) => {
      const message =
        source === "candidate"
          ? `[${product.product}] source image was unreachable — switched to an alternate image`
          : `[${product.product}] source image (and alternates) were unreachable — using a placeholder so this product still completes`;
      pushLog("warn", message);
    });
    setPreflightRunning(false);
    // Persist repairs so the row image + a reload/resume reflect the fixed URL, and so no
    // selected product is ever silently dropped.
    setSelectedProducts((prev) =>
      prev.map((product) => readyProducts.find((repaired) => repaired.id === product.id) ?? product)
    );
    try {
      sessionStorage.setItem(
        "pipeline:selected-products",
        JSON.stringify(selectedProducts.map((product) => readyProducts.find((repaired) => repaired.id === product.id) ?? product))
      );
    } catch {
      // best-effort persistence only
    }

    let pinterestBoards: PinterestBoard[] = [];
    try {
      const boardsResponse = await http.get("/api/v1/metricool/scheduler/boards/pinterest", {
        params: { userId: "1981059", blogId: "3410405" }
      });
      const boardsData = unwrapEnvelope<{ data?: PinterestBoard[] }>(boardsResponse.data);
      pinterestBoards = boardsData?.data ?? [];
      pinterestBoardsRef.current = pinterestBoards;
      pushLog("ok", `Pinterest boards fetched: ${pinterestBoards.length}`);
    } catch (error) {
      const message = getErrorMeta(error).message || "Failed to fetch Pinterest boards";
      pushLog("warn", `Pinterest boards fetch failed, continuing with no boards: ${message}`);
    }

    const storedPackagesById = getStoredPackagesByProductId(readyProducts);
    let succeededCount = 0;
    let failedCount = 0;
    for (const product of readyProducts) {
      const basePostPackage = storedPackagesById[product.id] ?? createBasePostPackage(product);
      if (product.productUrl) {
        basePostPackage.external_url = product.productUrl;
      }
      // No abort here on purpose: one product's failure (after internal auto-retry is
      // exhausted) must never stop the rest of the batch from running.
      const ok = await processProduct(product, basePostPackage, pinterestBoards);
      if (ok) succeededCount += 1;
      else failedCount += 1;
    }

    setPipelineRunning(false);
    if (failedCount > 0) {
      setPipelineError(`${succeededCount} completed, ${failedCount} failed. Use Retry on a failed product below.`);
      setPipelineRetryable(true);
      setCurrentProductLabel("Completed with errors");
      pushLog("err", `Pipeline finished: ${succeededCount} completed, ${failedCount} failed`);
    } else {
      setCurrentProductLabel("Completed");
      pushLog("ok", "Pipeline completed successfully");
    }
  };

  // Retries only the given products (never re-posts ones that already succeeded), resuming
  // each from whatever step productRunDataRef already has cached.
  const retryProducts = async (productsToRetry: StoredPipelineProduct[]) => {
    if (productsToRetry.length === 0) return;
    setPipelineError(null);
    setPipelineRunning(true);
    const storedPackagesById = getStoredPackagesByProductId(selectedProducts);
    let pinterestBoards = pinterestBoardsRef.current;
    if (pinterestBoards.length === 0) {
      try {
        const boardsResponse = await http.get("/api/v1/metricool/scheduler/boards/pinterest", {
          params: { userId: "1981059", blogId: "3410405" }
        });
        const boardsData = unwrapEnvelope<{ data?: PinterestBoard[] }>(boardsResponse.data);
        pinterestBoards = boardsData?.data ?? [];
        pinterestBoardsRef.current = pinterestBoards;
      } catch {
        // proceed with no boards; pickBestPinterestBoard will surface a clear error if needed
      }
    }

    let succeededCount = 0;
    let failedCount = 0;
    for (const product of productsToRetry) {
      const basePostPackage = storedPackagesById[product.id] ?? createBasePostPackage(product);
      if (product.productUrl) {
        basePostPackage.external_url = product.productUrl;
      }
      const ok = await processProduct(product, basePostPackage, pinterestBoards);
      if (ok) succeededCount += 1;
      else failedCount += 1;
    }

    setPipelineRunning(false);
    if (failedCount > 0) {
      setPipelineError(`${failedCount} product(s) still failing. Use Retry to try again.`);
      setPipelineRetryable(true);
    } else {
      setPipelineError(null);
      pushLog("ok", `Retry completed: ${succeededCount} product(s) fixed`);
    }
  };

  const retryOneProduct = (productId: string) => {
    const product = selectedProducts.find((item) => item.id === productId);
    if (!product) return;
    void retryProducts([product]);
  };

  const retryAllFailed = () => {
    const failedProducts = selectedProducts.filter((product) => productStates[product.id] === "failed");
    void retryProducts(failedProducts);
  };

  const statusBannerClass = !pipelineStarted
    ? "status-banner idle"
    : pipelineRunning
      ? "status-banner running"
      : pipelineError
        ? "status-banner"
        : "status-banner done";

  const statusIcon = !pipelineStarted ? "⏸" : pipelineRunning ? "▶" : pipelineError ? "⚠" : "✓";
  const statusTitle = !pipelineStarted ? "Ready to start" : pipelineRunning ? "Pipeline running" : pipelineError ? "Pipeline failed" : "Pipeline completed";
  const statusSub = !pipelineStarted
    ? `${readyCount} products queued · Review options and click Start pipeline`
    : preflightRunning
      ? "Validating source images..."
      : pipelineRunning
        ? `Running for ${currentProductLabel}`
        : pipelineError
          ? pipelineError
          : `Completed ${completedCount}/${selectedProducts.length} products`;

  return (
    <>
      <TopNav />
      <FlowStepper active={6} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 360px", minHeight: "calc(100vh - var(--nav-h) - var(--stepper-h))", gap: 0 }}>
        <div style={{ padding: 24, borderRight: "1px solid var(--border)", overflowY: "auto" }}>
          <div className={statusBannerClass}>
            <div className="status-icon">{statusIcon}</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{statusTitle}</div>
              <div style={{ fontSize: 13, color: "var(--text-3)", marginTop: 2 }}>{statusSub}</div>
            </div>
            <div style={{ marginLeft: "auto" }}>
              <button className="btn btn-primary btn-lg" onClick={runPipeline} disabled={pipelineRunning}>
                {pipelineRunning ? "Running..." : "▶ Start pipeline"}
              </button>
            </div>
          </div>

          <div style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-3)", marginBottom: 6 }}>
              <span>Overall progress</span>
              <span>{doneStepCount} / {totalStepCount} steps</span>
            </div>
            <div className="prog-track"><div className="prog-fill" style={{ width: `${overallPercent}%` }} /></div>
          </div>

          {selectedProducts.map((product) => {
            const isOpen = accordionOpen[product.id] !== false;
            const steps = productStepStates[product.id] ?? ["waiting", "waiting", "waiting", "waiting"];
            const state = productStates[product.id] ?? "waiting";
            return (
              <div key={product.id} className="prod-pipeline">
                <div className="prod-pipeline-head open" onClick={() => setAccordionOpen((prev) => ({ ...prev, [product.id]: !isOpen }))}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      overflow: "hidden",
                      border: "1px solid var(--border)",
                      background: "var(--bg-primary)",
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0
                    }}
                  >
                    {product.imageUrl ? (
                      <img
                        src={product.imageUrl}
                        alt={product.product}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(event) => {
                          event.currentTarget.style.display = "none";
                        }}
                      />
                    ) : (
                      <span style={{ fontSize: 11, color: "var(--text-secondary)", fontWeight: 600 }}>
                        {product.platform === "CJ" ? "CJ" : "IM"}
                      </span>
                    )}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{product.product}</div>
                    <div style={{ fontSize: 12, color: "var(--text-3)" }}>{product.platform} · ${product.price.toFixed(2)}</div>
                  </div>
                  <span className={`prod-status-pill ${state === "retrying" ? "running" : state}`}>
                    {state === "retrying"
                      ? `Retrying… (${(productRetryCount[product.id] ?? 0) + 1}/${PRODUCT_RETRY_DELAYS_MS.length + 1})`
                      : state.charAt(0).toUpperCase() + state.slice(1)}
                  </span>
                  {state === "failed" ? (
                    <button
                      className="btn btn-sm"
                      onClick={(event) => {
                        event.stopPropagation();
                        retryOneProduct(product.id);
                      }}
                      disabled={pipelineRunning}
                    >
                      Retry
                    </button>
                  ) : null}
                  <span style={{ color: "var(--text-3)", fontSize: 12 }}>{isOpen ? "▼" : "▶"}</span>
                </div>
                {isOpen ? (
                  <div className="prod-pipeline-body">
                    {PIPELINE_STEPS.map((step, index) => (
                      <div key={step} className="mini-step">
                        <div className={`mini-dot ${steps[index] === "done" ? "done" : steps[index] === "running" ? "running" : steps[index] === "failed" ? "error" : ""}`}>{index + 1}</div>
                        <span className={`mini-step-name ${steps[index] === "waiting" ? "muted" : ""}`}>{step}</span>
                        <span className="mini-step-time">{steps[index]}</span>
                      </div>
                    ))}
                    {state === "done" ? (
                      <div className="result-card">
                        <div style={{ fontWeight: 600, color: "var(--green)" }}>✓ Published successfully</div>
                        <div>
                          WordPress post:{" "}
                          {createdWpProducts.find((item) => item.productName === product.product)?.productId ?? "N/A"}
                        </div>
                        <div>Template: {selectedTemplateName ?? selectedTemplateId ?? "N/A"}</div>
                      </div>
                    ) : null}
                    {state === "failed" ? (
                      <div className="result-card" style={{ borderColor: "var(--red)" }}>
                        <div style={{ fontWeight: 600, color: "var(--red)" }}>
                          ✗ Failed after {PRODUCT_RETRY_DELAYS_MS.length + 1} automatic attempts
                        </div>
                        <div>Click Retry above to try again — completed steps for this product are reused, so no duplicate WordPress post is created.</div>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}

          {logLines.length > 0 ? (
            <div style={{ marginTop: 20 }}>
              <div className="section-title" style={{ marginBottom: 8 }}>Live log</div>
              <div className="log-stream">
                {logLines.map((line, index) => (
                  <div key={`${line.text}-${index}`} className={line.tone === "ok" ? "log-ok" : line.tone === "err" ? "log-err" : line.tone === "warn" ? "log-warn" : "log-info"}>
                    {line.text}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        <div style={{ padding: "20px 24px 20px 18px", background: "var(--bg)", overflowY: "auto" }}>
          <div className="section-title" style={{ marginBottom: 14 }}>Run summary</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
            <div className="card card-pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text)" }}>{selectedProducts.length}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Products</div>
            </div>
            <div className="card card-pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--green)" }}>{completedCount}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Completed</div>
            </div>
            <div className="card card-pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--red)" }}>{errorCount}</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Errors</div>
            </div>
            <div className="card card-pad" style={{ textAlign: "center" }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: "var(--text-2)" }}>{elapsedSeconds}s</div>
              <div style={{ fontSize: 11, color: "var(--text-3)" }}>Elapsed</div>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 14, padding: "16px 14px" }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Configuration</div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, padding: "10px 0", borderBottom: "1px solid var(--border)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>Template</span>
              <strong style={{ textAlign: "right", maxWidth: 170, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {selectedTemplateName ?? selectedTemplateId ?? "Not selected"}
              </strong>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, padding: "10px 0", borderBottom: "1px solid var(--border)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>WordPress</span><span style={{ color: "var(--green)", fontWeight: 600 }}>{options.wordpress ? "On" : "Off"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, padding: "10px 0", borderBottom: "1px solid var(--border)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>Metricool</span><span style={{ color: "var(--green)", fontWeight: 600 }}>{options.metricool ? "On" : "Off"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, padding: "10px 0", borderBottom: "1px solid var(--border)", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>GPT content</span><span style={{ color: "var(--green)", fontWeight: 600 }}>{options.gpt ? "On" : "Off"}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, fontSize: 13, padding: "10px 0 2px", lineHeight: 1.45 }}>
              <span style={{ color: "var(--text-3)", fontWeight: 500 }}>Image edit</span><span style={{ color: "var(--green)", fontWeight: 600 }}>{options.imageEdit ? "On" : "Off"}</span>
            </div>
          </div>

          <div className="card card-pad" style={{ marginBottom: 16, padding: "16px 14px" }}>
            <div className="section-title" style={{ marginBottom: 10 }}>Edit previous step</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
              <a className="btn btn-sm" href="/review" style={{ justifyContent: "space-between", padding: "10px 12px", borderColor: "var(--border)" }}>Products <span>→</span></a>
              <a className="btn btn-sm" href="/template" style={{ justifyContent: "space-between", padding: "10px 12px", borderColor: "var(--border)" }}>Template <span>→</span></a>
              <a className="btn btn-sm" href="/package" style={{ justifyContent: "space-between", padding: "10px 12px", borderColor: "var(--border)" }}>Post package <span>→</span></a>
            </div>
          </div>

          {pipelineStarted && !pipelineRunning && !pipelineError ? (
            <div style={{ display: "grid", gap: 8 }}>
              <button className="btn btn-lg" style={{ width: "100%", background: "var(--green-soft)", color: "var(--green)", border: "1px solid var(--green-soft)" }} disabled>
                ✓ Completed
              </button>
              <a className="btn btn-primary btn-lg" style={{ width: "100%", textAlign: "center" }} href="/search">
                Back to Home
              </a>
            </div>
          ) : null}

          {pipelineStarted && !pipelineRunning && pipelineError && pipelineRetryable ? (
            <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={retryAllFailed}>
              Retry all failed
            </button>
          ) : null}

          {loadingTemplates ? <p className="mt-2 text-xs text-slate-500">Loading templates...</p> : null}
          {templatesError ? <p className="mt-2 text-xs text-red-600">{templatesError}</p> : null}
        </div>
      </div>
    </>
  );
}
