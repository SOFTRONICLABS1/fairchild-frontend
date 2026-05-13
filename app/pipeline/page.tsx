"use client";
import { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/flow/top-nav";
import { http, unwrapEnvelope } from "@/lib/api/client";

type SelectedProduct = {
  id: string;
  product: string;
  imageUrl: string;
  productUrl: string;
  platform: "CJ" | "Impact";
  price: number;
  discount: number;
};

type RenderformTemplate = {
  identifier: string;
  name: string;
  preview: string;
};

type OptionKey = "wordpress" | "metricool" | "gpt" | "imageEdit";
type StepState = "waiting" | "running" | "done" | "failed";

type PostPackage = {
  Image_editing_text: string;
  name: string;
  type: "external";
  status: "draft";
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

export default function PipelinePage() {
  const [selectedProducts, setSelectedProducts] = useState<SelectedProduct[]>([]);
  const [productReady, setProductReady] = useState<Record<string, boolean>>({});
  const [templates, setTemplates] = useState<RenderformTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [templatesError, setTemplatesError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [pipelineStarted, setPipelineStarted] = useState(false);
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [currentProductLabel, setCurrentProductLabel] = useState<string>("No active product");
  const [stepStates, setStepStates] = useState<StepState[]>(["waiting", "waiting", "waiting", "waiting"]);
  const [pipelineError, setPipelineError] = useState<string | null>(null);
  const [createdWpProducts, setCreatedWpProducts] = useState<Array<{ product: string; productId: string | number; mediaId: number }>>([]);
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
      const parsed = JSON.parse(raw) as SelectedProduct[];
      setSelectedProducts(parsed);
      const readyMap: Record<string, boolean> = {};
      parsed.forEach((product) => {
        readyMap[product.id] = false;
      });
      setProductReady(readyMap);
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
        if (data.length > 0) {
          setSelectedTemplateId(data[0].identifier);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to fetch templates";
        setTemplatesError(message);
      } finally {
        setLoadingTemplates(false);
      }
    };
    void fetchTemplates();
  }, []);

  const readyCount = useMemo(
    () => Object.values(productReady).filter(Boolean).length,
    [productReady]
  );
  const selectedTemplateName = useMemo(
    () => templates.find((template) => template.identifier === selectedTemplateId)?.name ?? null,
    [selectedTemplateId, templates]
  );

  const toggleOption = (key: OptionKey) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const pipelineSteps = [
    "Create post package",
    "Download and edit image",
    "Create WordPress post",
    "Schedule to Metricool"
  ];

  const setStep = (index: number, state: StepState) => {
    setStepStates((prev) => prev.map((value, idx) => (idx === index ? state : value)));
  };

  const resetSteps = () => setStepStates(["waiting", "waiting", "waiting", "waiting"]);

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
      status: "draft",
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

  const buildMetricoolPayload = (mediaUrl: string, permalinkTemplate: string): MetricoolPayload => {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const dateTime = tomorrow.toISOString().slice(0, 19);
    return {
      text: `Automation Test\n${permalinkTemplate}`,
      autoPublish: true,
      draft: true,
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
        { network: "facebook" },
        { network: "instagram" },
        { network: "threads" },
        { network: "linkedin" },
        { network: "gmb" },
        { network: "tiktok" }
      ],
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
    if (readyProducts.length === 0) {
      setPipelineError("Mark at least one product as Ready");
      return;
    }

    setPipelineError(null);
    setPipelineStarted(true);
    setPipelineRunning(true);
    setCreatedWpProducts([]);

    for (const product of readyProducts) {
      resetSteps();
      setCurrentProductLabel(product.product);
      const basePostPackage = createBasePostPackage(product);
      setStep(0, "done");

      try {
        setStep(1, "running");
        const renderResponse = await http.post("/api/v1/renderform/render", {
          template: selectedTemplateId,
          titleText: basePostPackage.Image_editing_text,
          imageSrc: product.imageUrl,
          extraData: {}
        });
        const renderData = unwrapEnvelope<{ href: string }>(renderResponse.data);
        setStep(1, "done");

        setStep(2, "running");
        const mediaForm = new FormData();
        mediaForm.append("file", new Blob([]), "");
        mediaForm.append("image_url", renderData.href);
        const mediaUploadResponse = await http.post("/api/v1/wordpress/media/upload", mediaForm, {
          headers: {
            "Content-Type": "multipart/form-data"
          }
        });
        const mediaUploadData = unwrapEnvelope<{ id: number; guid?: { rendered?: string }; permalink_template?: string }>(mediaUploadResponse.data);
        setStep(2, "done");

        setStep(3, "running");

        const postPackagePayload = {
          name: basePostPackage.name,
          type: basePostPackage.type,
          status: basePostPackage.status,
          featured: basePostPackage.featured,
          catalog_visibility: basePostPackage.catalog_visibility,
          description: basePostPackage.description,
          short_description: basePostPackage.short_description,
          external_url: basePostPackage.external_url,
          button_text: basePostPackage.button_text,
          regular_price: basePostPackage.regular_price,
          sale_price: basePostPackage.sale_price,
          images: [{ id: mediaUploadData.id }],
          meta_data: basePostPackage.meta_data
        };

        const productCreateResponse = await http.post("/api/v1/wordpress/products", postPackagePayload);
        const wpProductData = unwrapEnvelope<{ id?: string | number }>(productCreateResponse.data);

        if (options.metricool) {
          const mediaUrl = mediaUploadData.guid?.rendered ?? "";
          const permalinkTemplate = mediaUploadData.permalink_template ?? "";
          const metricoolPayload = buildMetricoolPayload(mediaUrl, permalinkTemplate);
          await http.post(
            "/api/v1/metricool/scheduler/posts",
            metricoolPayload,
            { params: { userId: "1981059", blogId: "3410405" } }
          );
        }

        setStep(3, "done");
        setCreatedWpProducts((prev) => [...prev, { product: product.product, productId: wpProductData.id ?? "N/A", mediaId: mediaUploadData.id }]);
      } catch (error) {
        const state1 = stepStates[1];
        const state2 = stepStates[2];
        if (state1 === "running") setStep(1, "failed");
        if (state2 === "running") setStep(2, "failed");
        if (stepStates[3] === "running") setStep(3, "failed");
        setPipelineError(error instanceof Error ? error.message : "Pipeline failed");
        setPipelineRunning(false);
        return;
      }
    }

    setPipelineRunning(false);
    setCurrentProductLabel("Completed");
  };

  const completedSteps = stepStates.filter((state) => state === "done").length;
  const allStepsCompleted = completedSteps === pipelineSteps.length && pipelineSteps.length > 0;

  return (
    <>
      <TopNav right={<div className="text-sm text-slate-500">Results / <span className="font-medium text-slate-800">Pipeline</span></div>} />
      <div className="page-wrap">
        <h2 className="mb-1 text-[18px] font-medium">Run pipeline</h2>
        <p className="mb-4 text-sm text-slate-500">{selectedProducts.length} products selected · configure options and start</p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-4">
            <div className="card p-4">
              <p className="mb-3 text-sm font-medium">Selected products</p>
              {selectedProducts.length === 0 ? (
                <p className="text-sm text-slate-500">No products selected from results page.</p>
              ) : (
                selectedProducts.map((product) => (
                  <div key={product.id} className="mb-2 flex items-center justify-between rounded-md border border-slate-200 p-2 last:mb-0">
                    <div>
                      <p className="text-sm font-medium">{product.product}</p>
                      <p className="text-xs text-slate-500">${product.price.toFixed(2)} · {product.platform === "CJ" ? "CJ Affiliate" : "Impact"}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setProductReady((prev) => ({ ...prev, [product.id]: !prev[product.id] }))}
                      className={`rounded-full px-2 py-[2px] text-xs ${productReady[product.id] ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}
                    >
                      {productReady[product.id] ? "Ready" : "Not started"}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="card p-4">
              <p className="mb-3 text-sm font-medium">Select image template</p>
              {loadingTemplates ? <p className="text-sm text-slate-500">Loading templates...</p> : null}
              {templatesError ? <p className="text-sm text-red-600">{templatesError}</p> : null}
              <div className="grid gap-3 md:grid-cols-2">
                {templates.map((template) => (
                  <button
                    key={template.identifier}
                    type="button"
                    onClick={() => setSelectedTemplateId(template.identifier)}
                    className={`w-full overflow-hidden rounded-lg border p-2 text-left ${selectedTemplateId === template.identifier ? "border-[#185FA5] bg-[#E6F1FB]" : "border-slate-200 bg-white"}`}
                  >
                    <div className="mb-2 grid aspect-square w-full place-items-center overflow-hidden rounded bg-slate-50 p-2">
                      <img src={template.preview} alt={template.name} className="h-full w-full rounded object-contain" />
                    </div>
                    <p className="text-sm font-medium">{template.name}</p>
                  </button>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <p className="mb-3 text-sm font-medium">Options</p>
              <div className="space-y-2 text-sm text-slate-700">
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>Create WordPress post</span><button type="button" onClick={() => toggleOption("wordpress")} className={`rounded-full px-2 py-[2px] text-xs ${options.wordpress ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{options.wordpress ? "On" : "Off"}</button></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>Schedule to Metricool</span><button type="button" onClick={() => toggleOption("metricool")} className={`rounded-full px-2 py-[2px] text-xs ${options.metricool ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{options.metricool ? "On" : "Off"}</button></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>GPT-generated content</span><button type="button" onClick={() => toggleOption("gpt")} className={`rounded-full px-2 py-[2px] text-xs ${options.gpt ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{options.gpt ? "On" : "Off"}</button></div>
                <div className="flex items-center justify-between rounded-md border border-slate-200 p-2"><span>Edit image (resize + watermark)</span><button type="button" onClick={() => toggleOption("imageEdit")} className={`rounded-full px-2 py-[2px] text-xs ${options.imageEdit ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>{options.imageEdit ? "On" : "Off"}</button></div>
              </div>
              <button type="button" onClick={runPipeline} disabled={pipelineRunning} className="btn-primary mt-3 inline-block disabled:opacity-50">
                {pipelineRunning ? "Running..." : "Start pipeline"}
              </button>
            </div>
          </div>

          <div className="space-y-4">
            <div className="card p-4">
              <p className="mb-2 text-sm font-medium">Pipeline status</p>
              <p className="mb-2 text-xs text-slate-500">Current product: {currentProductLabel}</p>
              <div className="mb-1 flex justify-between text-xs text-slate-500"><span>Progress</span><span>{pipelineStarted ? `${completedSteps} / ${pipelineSteps.length} steps` : `0 / ${pipelineSteps.length} steps`}</span></div>
              <div className="mb-3 h-2 overflow-hidden rounded bg-slate-200"><div className="h-full bg-[#185FA5]" style={{ width: pipelineStarted ? `${Math.round((completedSteps / pipelineSteps.length) * 100)}%` : "0%" }} /></div>
              {pipelineError ? <p className="mb-2 text-xs text-red-600">{pipelineError}</p> : null}
              {allStepsCompleted ? <p className="mb-2 text-sm font-medium text-emerald-700">Completed!!</p> : null}
              <div className="space-y-2 text-sm">
                {pipelineSteps.map((step, index) => (
                  <div
                    key={step}
                    className={`rounded border p-2 ${
                      stepStates[index] === "done"
                        ? "border-emerald-200 bg-emerald-50"
                        : stepStates[index] === "running"
                          ? "border-[#185FA5] bg-[#E6F1FB]"
                          : stepStates[index] === "failed"
                            ? "border-rose-200 bg-rose-50"
                            : "border-slate-200 bg-white"
                    }`}
                  >
                    {index + 1}. {step} - {stepStates[index]}
                  </div>
                ))}
              </div>
            </div>

            <div className="card p-4">
              <p className="mb-2 text-sm font-medium">Run summary</p>
              <div className="flex justify-between border-b border-slate-200 py-2 text-sm"><span className="text-slate-500">Selected products</span><span>{selectedProducts.length}</span></div>
              <div className="flex justify-between border-b border-slate-200 py-2 text-sm"><span className="text-slate-500">Ready products</span><span>{readyCount}</span></div>
              <div className="flex justify-between border-b border-slate-200 py-2 text-sm"><span className="text-slate-500">Template</span><span>{selectedTemplateName ?? "Not selected"}</span></div>
              <div className="py-2 text-sm">
                <p className="mb-1 text-slate-500">Created WordPress products</p>
                {createdWpProducts.length === 0 ? (
                  <p className="text-xs text-slate-500">No products created yet.</p>
                ) : (
                  createdWpProducts.map((item) => (
                    <p key={`${item.product}-${item.productId}`} className="text-xs">
                      {item.product} · Product ID: {item.productId} · Media ID: {item.mediaId}
                    </p>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
