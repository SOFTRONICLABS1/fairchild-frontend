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

type AIPackageFields = {
  Image_editing_text?: string;
  name?: string;
  description?: string;
  short_description?: string;
  button_text?: string;
  metricool_schedule_datetime?: string;
};

const AI_MODELS = ["claude-sonnet-4-5"];

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
    status: "publish",
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [packages, setPackages] = useState<PostPackage[]>([]);
  const [savedTick, setSavedTick] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [regeneratingAll, setRegeneratingAll] = useState(false);
  const [regeneratingFields, setRegeneratingFields] = useState<Record<string, boolean>>({});
  const [aiReadyByProduct, setAiReadyByProduct] = useState<Record<string, boolean>>({});
  const [initialGeneratingIndex, setInitialGeneratingIndex] = useState<number | null>(null);
  const [scheduleTimeInput, setScheduleTimeInput] = useState("10:00");

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
    fields: Array<keyof PostPackage>,
    mode: "default" | "force_variation" = "default"
  ): Promise<AIPackageFields> => {
    const allowed = ["Image_editing_text", "name", "description", "short_description", "button_text", "metricool_schedule_datetime"];
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
  "url_hint_tokens": ${JSON.stringify(urlHint(base.external_url))}
}

Rules:
- Keep text safe for public affiliate post.
- Keep output concise and relevant.
- Use product title and external_url/url_hint_tokens to infer the actual item accurately.
- If generating button_text, keep default style close to "Buy Now".
- If generating metricool_schedule_datetime, choose best posting time between 1 hour from now and within next 24 hours.
${mode === "force_variation" ? "- Generate a clearly different variation than the previous value for each requested key." : ""}
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

  const regenField = async (key: keyof PostPackage) => {
    if (!activePackage || !activeProduct) return;
    const index = activeIndex;
    setAiError(null);
    setFieldLoading(index, key, true);
    try {
      const currentValue = activePackage[key];
      const firstTry = await generateFieldsWithAI(activeProduct, activePackage, [key], "default");
      let nextValue = pickFieldValue(firstTry, key).trim();
      let generated = firstTry;

      if (!nextValue || nextValue === String(currentValue ?? "").trim()) {
        const secondTry = await generateFieldsWithAI(activeProduct, activePackage, [key], "force_variation");
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
        "button_text",
        "metricool_schedule_datetime"
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
            "button_text",
            "metricool_schedule_datetime"
          ]);
          nextPackages[index] = {
            ...current,
            Image_editing_text: generated.Image_editing_text ?? current.Image_editing_text,
            name: generated.name ?? current.name,
            description: generated.description ?? current.description,
            short_description: generated.short_description ?? current.short_description,
            button_text: generated.button_text ?? current.button_text,
            metricool_schedule_datetime: generated.metricool_schedule_datetime ?? current.metricool_schedule_datetime
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

  const activeScheduleParts = useMemo(
    () => parseScheduleParts(activePackage?.metricool_schedule_datetime ?? ""),
    [activePackage?.metricool_schedule_datetime]
  );

  useEffect(() => {
    setScheduleTimeInput(`${activeScheduleParts.hour12}:${activeScheduleParts.minute}`);
  }, [activeScheduleParts.hour12, activeScheduleParts.minute, activeIndex]);

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
                label="Image text"
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
                label="Short description"
                multiline
                value={activePackage.short_description}
                onChange={(value) => patchActive("short_description", value)}
                onRegenerate={() => void regenField("short_description")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:short_description`])}
                initialGenerating={regeneratingAll && initialGeneratingIndex === activeIndex}
              />
              <Field
                label="Long Description"
                multiline
                value={activePackage.description}
                onChange={(value) => patchActive("description", value)}
                onRegenerate={() => void regenField("description")}
                regenerating={Boolean(regeneratingFields[`${activeIndex}:description`])}
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
              <div className="card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wordpress status</span>
                </div>
                <select
                  className="field"
                  value={activePackage.status}
                  onChange={(event) => patchActive("status", event.target.value as PostPackage["status"])}
                >
                  <option value="draft">draft</option>
                  <option value="pending">pending</option>
                  <option value="private">private</option>
                  <option value="publish">publish</option>
                </select>
              </div>
              <div className="card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metricool schedule date and time</span>
                  <button
                    type="button"
                    className="text-xs font-medium text-[#185FA5] disabled:opacity-50"
                    disabled={Boolean(regeneratingFields[`${activeIndex}:metricool_schedule_datetime`])}
                    onClick={() => void regenField("metricool_schedule_datetime")}
                  >
                    {regeneratingFields[`${activeIndex}:metricool_schedule_datetime`] ? "Generating..." : "✦ Regenerate"}
                  </button>
                </div>
                <div className="grid gap-2 sm:grid-cols-4">
                  <input
                    className="field sm:col-span-2"
                    type="date"
                    value={activeScheduleParts.date}
                    onChange={(event) =>
                      patchActive(
                        "metricool_schedule_datetime",
                        buildScheduleIso(
                          event.target.value,
                          activeScheduleParts.hour12,
                          activeScheduleParts.minute,
                          activeScheduleParts.period
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
                      patchActive(
                        "metricool_schedule_datetime",
                        buildScheduleIso(
                          activeScheduleParts.date,
                          hour12,
                          minute,
                          activeScheduleParts.period
                        )
                      );
                    }}
                    onBlur={() => {
                      const { hour12, minute } = normalizeTypedTime(scheduleTimeInput);
                      setScheduleTimeInput(`${hour12}:${minute}`);
                      patchActive(
                        "metricool_schedule_datetime",
                        buildScheduleIso(
                          activeScheduleParts.date,
                          hour12,
                          minute,
                          activeScheduleParts.period
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
                    value={activeScheduleParts.period}
                    onChange={(event) =>
                      patchActive(
                        "metricool_schedule_datetime",
                        buildScheduleIso(
                          activeScheduleParts.date,
                          activeScheduleParts.hour12,
                          activeScheduleParts.minute,
                          event.target.value as "AM" | "PM"
                        )
                      )
                    }
                  >
                    <option value="AM">AM</option>
                    <option value="PM">PM</option>
                  </select>
                </div>
              </div>
              <div className="card p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Metricool status</span>
                </div>
                <select
                  className="field"
                  value={activePackage.metricool_status}
                  onChange={(event) => patchActive("metricool_status", event.target.value as PostPackage["metricool_status"])}
                >
                  <option value="draft">draft</option>
                  <option value="publish">publish</option>
                </select>
              </div>

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
