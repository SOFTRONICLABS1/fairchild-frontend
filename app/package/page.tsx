"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";

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

type AIPackageFields = {
  Image_editing_text?: string;
  name?: string;
  description?: string;
  short_description?: string;
  button_text?: string;
};

const AI_MODELS = ["claude-sonnet-4-5"];

function normalizeName(title: string): string {
  return title
    .replace(/\s*\|\s*[^|]+$/g, "")
    .replace(/\s*-\s*(xs|s|m|l|xl|xxl|small|medium|large|x-large)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
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

function createPackage(product: SelectedProduct): PostPackage {
  const salePrice = product.discount > 0 ? product.price : 0;
  const regularPrice = product.discount > 0
    ? product.price / (1 - product.discount / 100)
    : product.price;

  return {
    Image_editing_text: "Keyname_Value",
    name: normalizeName(product.product),
    type: "external",
    status: "draft",
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [packages, setPackages] = useState<PostPackage[]>([]);
  const [savedTick, setSavedTick] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [regeneratingFields, setRegeneratingFields] = useState<Record<string, boolean>>({});
  const [aiReadyByProduct, setAiReadyByProduct] = useState<Record<string, boolean>>({});
  const [initialGeneratingIndex, setInitialGeneratingIndex] = useState<number | null>(null);

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

  const activeProduct = useMemo(() => products[activeIndex] ?? null, [products, activeIndex]);
  const activePackage = useMemo(() => packages[activeIndex] ?? null, [packages, activeIndex]);

  const flashSaved = () => {
    setSavedTick(true);
    window.setTimeout(() => setSavedTick(false), 1200);
  };

  const patchActive = <K extends keyof PostPackage>(key: K, value: PostPackage[K]) => {
    setPackages((prev) => {
      const next = prev.map((item, idx) => (idx === activeIndex ? { ...item, [key]: value } : item));
      sessionStorage.setItem("pipeline:post-packages", JSON.stringify(next));
      return next;
    });
  };

  const setFieldLoading = (index: number, key: keyof PostPackage, value: boolean) => {
    const stateKey = `${index}:${key}`;
    setRegeneratingFields((prev) => ({ ...prev, [stateKey]: value }));
  };

  const extractJsonObject = (value: string): string | null => {
    const first = value.indexOf("{");
    const last = value.lastIndexOf("}");
    if (first < 0 || last < 0 || last <= first) return null;
    return value.slice(first, last + 1);
  };

  const generateFieldsWithAI = async (
    product: SelectedProduct,
    base: PostPackage,
    fields: Array<keyof PostPackage>
  ): Promise<AIPackageFields> => {
    const allowed = ["Image_editing_text", "name", "description", "short_description", "button_text"];
    const requested = fields.filter((field) => allowed.includes(field));
    if (requested.length === 0) return {};

    const prompt = `
You generate ecommerce post-package fields.
Return ONLY strict JSON. No markdown.

Allowed keys:
- Image_editing_text: one short punchy phrase (1-3 words)
- name: clean product title, remove sizes/codes/noise
- description: 2-4 sentence marketing copy
- short_description: one concise sentence
- button_text: CTA text

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
  "url_hint_tokens": ${JSON.stringify(urlHint(base.external_url))}
}

Rules:
- Keep text safe for public affiliate post.
- Keep output concise and relevant.
- Use product title and external_url/url_hint_tokens to infer the actual item accurately.
- If generating button_text, keep default style close to "Buy Now".
`.trim();

    const response = await http.post("/api/v1/claude/generate", {
      prompt,
      modelCandidates: AI_MODELS,
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
    if (!jsonText) throw new Error("AI did not return valid JSON");
    const parsed = JSON.parse(jsonText) as AIPackageFields;

    if (parsed.name) parsed.name = normalizeName(parsed.name);
    if (parsed.Image_editing_text) parsed.Image_editing_text = parsed.Image_editing_text.trim().split(/\s+/).slice(0, 3).join(" ");
    if (parsed.button_text && !parsed.button_text.trim()) parsed.button_text = "Buy Now";

    return parsed;
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
      };
      sessionStorage.setItem("pipeline:post-packages", JSON.stringify(next));
      return next;
    });
    flashSaved();
  };

  const regenField = async (key: keyof PostPackage) => {
    if (!activePackage || !activeProduct) return;
    const index = activeIndex;
    setAiError(null);
    setFieldLoading(index, key, true);
    try {
      const generated = await generateFieldsWithAI(activeProduct, activePackage, [key]);
      applyGeneratedFields(index, generated);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Failed to regenerate field");
    } finally {
      setFieldLoading(index, key, false);
    }
  };

  const regenAll = async () => {
    if (!activePackage || !activeProduct) return;
    const index = activeIndex;
    setAiError(null);
    setRegeneratingAll(true);
    try {
      const generated = await generateFieldsWithAI(activeProduct, activePackage, [
        "Image_editing_text",
        "name",
        "description",
        "short_description",
        "button_text"
      ]);
      applyGeneratedFields(index, generated);
    } catch (error) {
      setAiError(error instanceof Error ? error.message : "Failed to regenerate fields");
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
        const nextReady: Record<string, boolean> = {};
        for (let index = 0; index < products.length; index += 1) {
          setInitialGeneratingIndex(index);
          const product = products[index];
          const current = nextPackages[index];
          if (!product || !current) continue;
          const generated = await generateFieldsWithAI(product, current, [
            "Image_editing_text",
            "name",
            "description",
            "short_description",
            "button_text"
          ]);
          nextPackages[index] = {
            ...current,
            Image_editing_text: generated.Image_editing_text ?? current.Image_editing_text,
            name: generated.name ?? current.name,
            description: generated.description ?? current.description,
            short_description: generated.short_description ?? current.short_description,
            button_text: generated.button_text ?? current.button_text
          };
          nextReady[product.id] = true;
        }
        setPackages(nextPackages);
        setAiReadyByProduct((prev) => ({ ...prev, ...nextReady }));
        sessionStorage.setItem("pipeline:post-packages", JSON.stringify(nextPackages));
      } catch (error) {
        setAiError(error instanceof Error ? error.message : "Failed to generate package content");
      } finally {
        setInitialGeneratingIndex(null);
        setRegeneratingAll(false);
      }
    };
    void runInitialAI();
  }, [packages, products]);

  const allProductsAiReady = useMemo(() => {
    if (products.length === 0) return false;
    return products.every((product) => aiReadyByProduct[product.id]);
  }, [aiReadyByProduct, products]);

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
                disabled={regeneratingAll}
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

          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)", marginBottom: 20, overflowX: "auto" }}>
            {products.map((product, idx) => (
              <button
                key={product.id}
                onClick={() => setActiveIndex(idx)}
                style={{
                  padding: "10px 16px",
                  fontSize: 13,
                  fontWeight: idx === activeIndex ? 700 : 500,
                  color: idx === activeIndex ? "var(--blue)" : "var(--text-3)",
                  borderBottom: idx === activeIndex ? "2px solid var(--blue)" : "2px solid transparent",
                  background: "transparent",
                  borderTop: "none",
                  borderLeft: "none",
                  borderRight: "none",
                  whiteSpace: "nowrap"
                }}
              >
                {product.product}
                {aiReadyByProduct[product.id] ? null : (
                  <span className="ml-2 inline-block h-1.5 w-1.5 rounded-full bg-slate-400 align-middle animate-pulse" />
                )}
              </button>
            ))}
          </div>

          {activePackage ? (
            <div className="space-y-3">
              <Field
                label="Image editing text"
                value={activePackage.Image_editing_text}
                onChange={(value) => patchActive("Image_editing_text", value)}
                onRegenerate={() => void regenField("Image_editing_text")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:Image_editing_text`])}
                initialGenerating={regeneratingAll && initialGeneratingIndex === activeIndex}
              />
              <Field
                label="Post title"
                value={activePackage.name}
                onChange={(value) => patchActive("name", value)}
                onRegenerate={() => void regenField("name")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:name`])}
                initialGenerating={regeneratingAll && initialGeneratingIndex === activeIndex}
              />
              <Field
                label="Description"
                multiline
                value={activePackage.description}
                onChange={(value) => patchActive("description", value)}
                onRegenerate={() => void regenField("description")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:description`])}
                initialGenerating={regeneratingAll && initialGeneratingIndex === activeIndex}
              />
              <Field
                label="Short description"
                multiline
                value={activePackage.short_description}
                onChange={(value) => patchActive("short_description", value)}
                onRegenerate={() => void regenField("short_description")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:short_description`])}
                initialGenerating={regeneratingAll && initialGeneratingIndex === activeIndex}
              />
              <Field
                label="Call to action"
                value={activePackage.button_text}
                onChange={(value) => patchActive("button_text", value)}
                onRegenerate={() => void regenField("button_text")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:button_text`])}
                initialGenerating={regeneratingAll && initialGeneratingIndex === activeIndex}
              />

            </div>
          ) : (
            <div className="card p-4 text-sm text-slate-500">No selected products found.</div>
          )}
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
            </div>
          </div>

          <div className="card p-4" style={{ marginBottom: 14 }}>
            <p className="mb-3 text-sm font-semibold">Actions</p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                className="btn btn-primary text-left disabled:cursor-not-allowed disabled:opacity-60"
                disabled={!allProductsAiReady || regeneratingAll}
                onClick={() => router.push("/pipeline")}
              >
                Start pipeline → Step 6
              </button>
              <Link className="btn btn-secondary" href="/template">← Back to template</Link>
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
