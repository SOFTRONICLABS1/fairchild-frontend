"use client";
import { useState } from "react";
import type { HistoryItem } from "@/lib/types/api";
import ResponseViewer from "@/components/common/response-viewer";
import HistoryPanel from "@/components/common/history-panel";
import { useToast } from "@/components/common/toast";

export default function SectionRunner({ title, run, payload }: { title: string; run: () => Promise<unknown>; payload?: unknown }) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<unknown>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const { push } = useToast();

  const execute = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await run();
      setData(response);
      setHistory((s) => [{ timestamp: new Date().toISOString(), action: title, request: payload ?? null, response }, ...s].slice(0, 8));
      push(`${title} success`, "success");
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setError(msg);
      setHistory((s) => [{ timestamp: new Date().toISOString(), action: title, request: payload ?? null, error: msg }, ...s].slice(0, 8));
      push(`${title} failed`, "error");
    } finally {
      setLoading(false);
    }
  };

  return <div className="space-y-3 rounded border bg-slate-50 p-4">
    <div className="flex items-center justify-between"><h3 className="font-medium">{title}</h3><button onClick={execute} disabled={loading} className="rounded bg-slate-900 px-3 py-2 text-sm text-white disabled:opacity-50">{loading ? "Running..." : "Run"}</button></div>
    {error && <p className="text-sm text-red-600">{error}</p>}
    {data && <ResponseViewer data={data} />}
    <HistoryPanel items={history} />
  </div>;
}
