"use client";
import { useState } from "react";

export default function ResponseViewer({ data }: { data: unknown }) {
  const [copied, setCopied] = useState(false);
  const pretty = JSON.stringify(data, null, 2);
  return <div className="rounded border bg-white p-3">
    <button className="mb-2 rounded bg-slate-800 px-2 py-1 text-xs text-white" onClick={async()=>{await navigator.clipboard.writeText(pretty); setCopied(true); setTimeout(()=>setCopied(false),1200);}}>{copied?"Copied":"Copy JSON"}</button>
    <pre className="overflow-auto text-xs">{pretty}</pre>
  </div>;
}
