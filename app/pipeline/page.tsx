"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";
import { getErrorMeta } from "@/lib/api/errors";

type SelectedProduct = {
  id: string;
  product: string;
  campaignId?: string;
  imageUrl: string;
  productUrl: string;
  platform: "CJ" | "Impact";
  price: number;
  discount: number;
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
type ProductRunState = "waiting" | "running" | "done" | "failed";

type PostPackage = {
  Image_editing_text: string;
  name: string;
  type: "external";
  status: "draft" | "pending" | "private" | "publish";
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

type WordPressProductPayload = Omit<PostPackage, "Image_editing_text" | "metricool_schedule_datetime" | "metricool_status">;

const PIPELINE_STEPS = [
  "Create post package",
  "Download and edit image",
  "Create WordPress post",
  "Schedule to Metricool"
];

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
  const recentHashtagSetsRef = useRef<string[][]>([]);
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

    const requestTextFromAi = async (variation: "default" | "force_variation"): Promise<string | null> => {
      const prompt = `
You write social media caption text for affiliate product posts.
Return ONLY strict JSON: {"text":"string"}

Rules:
- 2 to 4 lines max.
- Concise, engaging, no hashtags spam.
- Mention key product benefit naturally.
- Final line MUST be exactly: Buy now: ${permalink}
- Add exactly one hashtag line after Buy now.
- Hashtag line MUST contain 4 to 6 hashtags.
- Hashtags must be relevant and specific to product category/brand/use-case.
- Avoid repeating generic fixed hashtag sets.
- Do not reuse these previous hashtag sets from current run: ${JSON.stringify(bannedSignatures)}
${variation === "force_variation" ? "- IMPORTANT: use a clearly different hashtag set than previous outputs." : ""}

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

      const response = await http.post("/api/v1/claude/generate", {
        prompt,
        modelCandidates: ["claude-sonnet-4-5"],
        maxTokens: 300,
        temperature: 0.85
      });

      const data = unwrapEnvelope<unknown>(response.data);
      const rawText =
        typeof data === "string"
          ? data
          : JSON.stringify(
              (data as Record<string, unknown>)?.text ??
              (data as Record<string, unknown>)?.output ??
              (data as Record<string, unknown>)?.content ??
              (data as Record<string, unknown>)?.response ??
              data
            );
      const first = rawText.indexOf("{");
      const last = rawText.lastIndexOf("}");
      if (first < 0 || last < 0 || last <= first) {
        return null;
      }

      try {
        const parsed = JSON.parse(rawText.slice(first, last + 1)) as { text?: string };
        return parsed.text?.trim() ?? null;
      } catch {
        return null;
      }
    };

    const firstCandidate = await requestTextFromAi("default");
    if (!firstCandidate) {
      return ensureCaptionShape(`${postPackage.description}\n\nBuy now: ${permalink}\n${fallbackTags}`);
    }

    const firstTags = extractTagsFromText(firstCandidate);
    const tooSimilar = recentHashtagSetsRef.current.some((previous) => tagOverlapScore(firstTags, previous) >= 0.8);
    const weakTags = firstTags.length < 4 || firstTags.length > 6;

    if (tooSimilar || weakTags) {
      const secondCandidate = await requestTextFromAi("force_variation");
      if (secondCandidate) {
        const secondTags = extractTagsFromText(secondCandidate);
        const stillTooSimilar = recentHashtagSetsRef.current.some((previous) => tagOverlapScore(secondTags, previous) >= 0.8);
        if (!stillTooSimilar && secondTags.length >= 4 && secondTags.length <= 6) {
          return ensureCaptionShape(secondCandidate);
        }
      }
    }

    return ensureCaptionShape(firstCandidate);
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
    return {
      text,
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

  const runPipeline = async () => {
    if (!selectedTemplateId) {
      setPipelineError("Please select a template");
      return;
    }
    const readyProducts = selectedProducts.filter((product) => productReady[product.id]);
    const storedPackagesById = getStoredPackagesByProductId(selectedProducts as StoredPipelineProduct[]);
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
    pushLog("info", `Pipeline started for ${readyProducts.length} products`);

    let pinterestBoards: PinterestBoard[] = [];
    try {
      const boardsResponse = await http.get("/api/v1/metricool/scheduler/boards/pinterest", {
        params: { userId: "1981059", blogId: "3410405" }
      });
      const boardsData = unwrapEnvelope<{ data?: PinterestBoard[] }>(boardsResponse.data);
      pinterestBoards = boardsData?.data ?? [];
      pushLog("ok", `Pinterest boards fetched: ${pinterestBoards.length}`);
    } catch (error) {
      const message = getErrorMeta(error).message || "Failed to fetch Pinterest boards";
      pushLog("warn", `Pinterest boards fetch failed, continuing with no boards: ${message}`);
    }

    for (const product of readyProducts) {
      resetProductSteps(product.id);
      setProductState(product.id, "running");
      setAccordionOpen((prev) => ({ ...prev, [product.id]: true }));
      setCurrentProductLabel(product.product);
      pushLog("info", `[${product.product}] starting`);
      const basePostPackage = storedPackagesById[product.id] ?? createBasePostPackage(product);
      if (product.productUrl) {
        basePostPackage.external_url = product.productUrl;
      }

      try {
        setProductStep(product.id, 0, "running");
        await Promise.resolve();
        setProductStep(product.id, 0, "done");

        setProductStep(product.id, 1, "running");
        const renderResponse = await http.post("/api/v1/renderform/render", {
          template: selectedTemplateId,
          titleText: basePostPackage.Image_editing_text,
          imageSrc: product.imageUrl,
          extraData: {}
        });
        const renderData = unwrapEnvelope<{ href: string }>(renderResponse.data);
        setProductStep(product.id, 1, "done");
        pushLog("ok", `[${product.product}] image rendered`);

        setProductStep(product.id, 2, "running");
        const mediaForm = new FormData();
        mediaForm.append("file", new Blob([]), "");
        mediaForm.append("image_url", renderData.href);
        const mediaUploadResponse = await http.post("/api/v1/wordpress/media/upload", mediaForm, {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        });
        const mediaUploadData = unwrapEnvelope<{ id: number; guid?: { rendered?: string }; permalink_template?: string }>(mediaUploadResponse.data);

        const postPackagePayload = buildWordPressProductPayload(basePostPackage, mediaUploadData.id);

        const productCreateResponse = await http.post("/api/v1/wordpress/products", postPackagePayload);
        const wpProductData = unwrapEnvelope<{ id?: string | number; permalink?: string }>(productCreateResponse.data);
        setProductStep(product.id, 2, "done");
        pushLog("ok", `[${product.product}] wordpress product created`);

        setProductStep(product.id, 3, "running");
        if (options.metricool) {
          const mediaUrl = mediaUploadData.guid?.rendered ?? "";
          const wpPermalink = wpProductData.permalink ?? "";
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
        setCreatedWpProducts((prev) => [...prev, { productId: wpProductData.id ?? "N/A", mediaId: mediaUploadData.id, productName: product.product }]);
        pushLog("ok", `[${product.product}] completed`);
      } catch (error) {
        const meta = getErrorMeta(error);
        setProductState(product.id, "failed");
        setProductStepStates((prev) => {
          const current = prev[product.id] ?? ["waiting", "waiting", "waiting", "waiting"];
          const next = current.map((step) => (step === "running" ? "failed" : step)) as StepState[];
          return { ...prev, [product.id]: next };
        });
        const message = meta.message || "Pipeline failed";
        setPipelineError(message);
        setPipelineRetryable(meta.retryable);
        pushLog(
          "err",
          `[${product.product}] failed${meta.step ? ` at ${meta.step}` : ""}${meta.code ? ` (${meta.code})` : ""}: ${message}`
        );
        setPipelineRunning(false);
        return;
      }
    }

    setPipelineRunning(false);
    setCurrentProductLabel("Completed");
    pushLog("ok", "Pipeline completed successfully");
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
                  <span className={`prod-status-pill ${state}`}>{state.charAt(0).toUpperCase() + state.slice(1)}</span>
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
            <button className="btn btn-primary btn-lg" style={{ width: "100%" }} onClick={() => void runPipeline()}>
              Retry failed run
            </button>
          ) : null}

          {loadingTemplates ? <p className="mt-2 text-xs text-slate-500">Loading templates...</p> : null}
          {templatesError ? <p className="mt-2 text-xs text-red-600">{templatesError}</p> : null}
        </div>
      </div>
    </>
  );
}
