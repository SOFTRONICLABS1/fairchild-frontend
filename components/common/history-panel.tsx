import type { HistoryItem } from "@/lib/types/api";

export default function HistoryPanel({ items }: { items: HistoryItem[] }) {
  if (!items.length) return <div className="rounded border border-dashed p-3 text-sm text-slate-500">No requests yet.</div>;
  return <div className="space-y-2">{items.map((i, idx) => <div key={idx} className="rounded border bg-white p-2 text-xs"><div className="font-medium">{i.action} - {i.timestamp}</div><div className="text-slate-600">{i.error ?? "Success"}</div></div>)}</div>;
}
