"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import TopNav from "@/components/flow/top-nav";
import FlowStepper from "@/components/flow/stepper";

type SelectedProduct = {
  id: string;
  product: string;
  imageUrl: string;
  productUrl: string;
  platform: "CJ" | "Impact";
  price: number;
  discount: number;
};

export default function ReviewPage() {
  const [items, setItems] = useState<SelectedProduct[]>([]);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);
  const [resultsHref, setResultsHref] = useState("/results");

  useEffect(() => {
    const raw = sessionStorage.getItem("pipeline:selected-products");
    const lastResults = sessionStorage.getItem("pipeline:last-results-url");
    if (lastResults) {
      setResultsHref(lastResults);
    }
    if (!raw) return;
    try {
      setItems(JSON.parse(raw) as SelectedProduct[]);
    } catch {
      setItems([]);
    }
  }, []);

  const count = useMemo(() => items.length, [items]);

  const removeItem = (id: string) => {
    setItems((prev) => {
      const next = prev.filter((item) => item.id !== id);
      sessionStorage.setItem("pipeline:selected-products", JSON.stringify(next));
      return next;
    });
  };

  const markResultsRestore = () => {
    sessionStorage.setItem("pipeline:allow-results-restore", "1");
  };

  return (
    <>
      <TopNav />
      <FlowStepper active={3} />
      <div className="page-wrap">
        <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-3">
            <div className="mb-1 flex items-center justify-between">
              <h2 className="text-lg font-semibold">Review your selection</h2>
              {/* + Add more products hidden for now */}
            </div>
            <p className="mb-2 text-sm text-slate-500">{count} products selected. Remove unwanted items before continuing.</p>
            {items.map((item) => (
              <div key={item.id} className="card p-3">
                <div className="flex items-start gap-3">
                  {item.imageUrl ? (
                    <button type="button" onClick={() => setPreview({ title: item.product, url: item.imageUrl })} className="rounded">
                      <img src={item.imageUrl} alt={item.product} className="h-16 w-16 rounded object-contain bg-slate-50" />
                    </button>
                  ) : <div className="h-16 w-16 rounded bg-slate-100" />}
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex items-start justify-between gap-2">
                      <p className="truncate text-sm font-semibold">{item.product}</p>
                      <button type="button" onClick={() => removeItem(item.id)} className="rounded border border-rose-200 bg-rose-50 px-2 py-1 text-xs text-rose-700">Remove</button>
                    </div>
                    <p className="text-xs text-slate-500">${item.price.toFixed(2)} · {item.platform} · {item.discount}% off</p>
                    {item.productUrl ? (
                      <a href={item.productUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-[#185FA5] hover:underline">
                        Product URL ↗
                      </a>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
            {items.length === 0 ? <div className="card p-4 text-sm text-slate-500">No products selected.</div> : null}
          </div>

          <aside className="card h-fit p-4">
            <p className="mb-3 text-sm font-semibold">Selection summary</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-slate-500">Products</span><span>{count}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Platforms</span><span>{Array.from(new Set(items.map((item) => item.platform))).join(", ") || "-"}</span></div>
            </div>
            <div className="mt-4 flex flex-col gap-2">
              <Link href={resultsHref} className="btn-secondary text-center" onClick={markResultsRestore}>Back to Results</Link>
              <Link href="/template" className="btn-primary text-center">Continue to Template Selection</Link>
            </div>
          </aside>
          <div className="lg:col-span-2">
            <div className="mt-1 h-14" />
          </div>
        </div>
      </div>
      {preview ? (
        <div className="fixed inset-0 z-40 grid place-items-center bg-slate-900/50 p-4">
          <div className="w-full max-w-[560px] rounded-xl border border-slate-200 bg-white p-3 shadow-2xl">
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="truncate text-sm font-medium">{preview.title}</p>
              <button type="button" onClick={() => setPreview(null)} className="rounded border border-slate-200 px-2 py-1 text-xs text-slate-500">Close</button>
            </div>
            <div className="grid h-[420px] place-items-center overflow-hidden rounded-lg bg-slate-50 p-3">
              <img src={preview.url} alt={preview.title} className="h-full w-full rounded object-contain" />
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
