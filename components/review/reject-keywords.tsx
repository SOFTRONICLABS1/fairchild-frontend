"use client";

import { useEffect, useState } from "react";
import { reviewApi } from "@/lib/review/api";

/** Shared reject-keyword list (the same list the GPC automation uses as "Words to skip"). */
export default function RejectKeywords({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [saved, setSaved] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  useEffect(() => {
    if (!open || saved) return;
    void reviewApi
      .keywords()
      .then((r) => {
        const joined = r.keywords.join(", ");
        setText(joined);
        setSaved(joined);
      })
      .catch(() => setState("error"));
  }, [open, saved]);

  const save = async () => {
    setState("saving");
    try {
      const r = await reviewApi.saveKeywords(text);
      const joined = r.keywords.join(", ");
      setText(joined);
      setSaved(joined);
      setState("idle");
      onSaved?.();
    } catch {
      setState("error");
    }
  };

  return (
    <div className="mb-3 rounded-xl border border-slate-200 bg-white">
      <button type="button" className="flex w-full items-center justify-between p-3 text-left text-sm font-medium" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>Reject keywords {saved ? <span className="font-normal text-slate-500">· {saved.split(",").filter(Boolean).length} words</span> : null}</span>
        <span aria-hidden>{open ? "▲" : "▼"}</span>
      </button>
      {open ? (
        <div className="border-t border-slate-200 p-3">
          <p className="mb-2 text-xs text-slate-500">
            Products whose title, brand or description contain any of these words or names are rejected before posting (for example a persona like “deadman”).
            The same list is used by the GPC automation.
          </p>
          <textarea className="field" rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. deadman, undertaker, gun, vape" />
          <div className="mt-2 flex items-center gap-3">
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={state === "saving" || text === saved}>
              {state === "saving" ? "Saving…" : "Save and re-check"}
            </button>
            {state === "error" ? <span className="text-xs text-red-600">Could not reach the backend. Try again.</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
