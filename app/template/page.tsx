"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";
import { http, unwrapEnvelope } from "@/lib/api/client";

type RenderformTemplate = {
  identifier: string;
  name: string;
  preview: string;
  createdAt?: string;
};

export default function TemplatePage() {
  const [templates, setTemplates] = useState<RenderformTemplate[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await http.get("/api/v1/renderform/templates");
        const list = unwrapEnvelope<RenderformTemplate[]>(response.data);
        const ordered = [...list].sort((a, b) => {
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return aTime - bTime;
        });
        setTemplates(ordered);
        const fallback = ordered[0]?.identifier ?? null;
        setSelectedTemplateId(fallback);
      } catch (fetchError) {
        setError(fetchError instanceof Error ? fetchError.message : "Failed to load templates");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const continueNext = () => {
    if (selectedTemplateId) {
      sessionStorage.setItem("pipeline:selected-template", selectedTemplateId);
      const selectedTemplate = templates.find((template) => template.identifier === selectedTemplateId);
      if (selectedTemplate?.name) {
        sessionStorage.setItem("pipeline:selected-template-name", selectedTemplate.name);
      }
    }
  };

  return (
    <>
      <TopNav />
      <FlowStepper active={4} />
      <div className="page-wrap">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_320px]">
          <div>
            <h2 className="mb-1 text-lg font-semibold">Select image template</h2>
            <p className="mb-4 text-sm text-slate-500">Choose the Renderform template for product creatives.</p>
            {loading ? <p className="text-sm text-slate-500">Loading templates...</p> : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {templates.map((template) => (
                <button
                  key={template.identifier}
                  type="button"
                  onClick={() => setSelectedTemplateId(template.identifier)}
                  className={`card relative p-2 text-left ${
                    selectedTemplateId === template.identifier
                      ? "border-2 border-[#185FA5] bg-[#F3F8FE] ring-2 ring-[#185FA5]/30"
                      : "border border-slate-200"
                  }`}
                >
                  <div className="mb-2 grid aspect-[4/5] place-items-center rounded bg-slate-50 p-2">
                    <img src={template.preview} alt={template.name} className="h-full w-full object-contain" />
                  </div>
                  <p className="text-sm font-medium">{template.name}</p>
                  {selectedTemplateId === template.identifier ? (
                    <span className="absolute right-3 top-3 rounded-full bg-[#185FA5] px-2 py-[2px] text-[10px] font-semibold text-white">Selected</span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <aside className="card h-fit p-4">
            <p className="mb-3 text-sm font-semibold">Template summary</p>
            <div className="mb-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Loaded</span><span>{templates.length}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Selected</span><span>{templates.find((item) => item.identifier === selectedTemplateId)?.name ?? "None"}</span></div>
            </div>
            <div className="flex flex-col gap-2">
              <Link href="/review" className="btn-secondary text-center">Back to review</Link>
              <Link href="/package" className="btn-primary text-center" onClick={continueNext}>Continue to Post Package Generation</Link>
            </div>
          </aside>
          <div className="lg:col-span-2">
            <div className="mt-1 h-14" />
          </div>
        </div>
      </div>
    </>
  );
}
