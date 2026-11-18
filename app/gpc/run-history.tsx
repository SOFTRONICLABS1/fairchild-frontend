"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { automationApi, type Run } from "@/lib/automation/api";

function StatusBadge({ status }: { status: Run["status"] }) {
  const cls = status === "completed" ? "ok" : status === "running" ? "run" : status === "partial" || status === "cancelled" ? "warn" : "err";
  return <span className={`gpc-pill gpc-pill-${cls}`}>{status}</span>;
}

type Kind = "product" | "blog";

/** Run history list. `limit` rows are shown (5 on the main page, all 100 on the history page). */
export default function RunHistory({ kind, limit, full }: { kind: Kind; limit?: number; full?: boolean }) {
  const [openId, setOpenId] = useState<number | null>(null);
  const runs = useQuery({
    queryKey: ["automation-runs", kind],
    queryFn: () => automationApi.runs(kind),
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === "running") ? 3000 : 15000)
  });
  const detail = useQuery({
    queryKey: ["automation-run", openId],
    queryFn: () => automationApi.run(openId as number),
    enabled: openId !== null,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 3000 : false)
  });
  const all = runs.data ?? [];
  const list = limit ? all.slice(0, limit) : all;
  const noun = kind === "product" ? "product" : "blog";
  const label = (r: Run) => {
    const s = r.summary;
    return kind === "product"
      ? `${r.dry_run ? `${s.would_create ?? 0} would create` : `${s.created ?? 0} created`}${s.target ? ` of ${s.target}` : ""} · ${s.categories_done ?? 0} categories tried · ${s.errors ?? 0} errors`
      : `${s.published ?? 0} published${r.dry_run ? ` · ${s.would_publish ?? 0} would publish` : ""} · ${s.errors ?? 0} errors`;
  };

  return (
    <section className="card gpc-section">
      <div className="gpc-section-head">
        <span className="gpc-step">↺</span>
        <div style={{ flex: 1 }}>
          <h3>{full ? `All ${noun} runs` : "Run history"}</h3>
          <p>{full ? `Your last ${all.length} ${noun} runs, newest first.` : `Latest ${Math.min(limit ?? all.length, all.length)} of ${all.length} ${noun} runs. Click a run to see what happened.`}</p>
        </div>
        {!full && all.length > (limit ?? 0) ? (
          <Link href={`/gpc/history/${kind}`} className="btn-secondary btn-sm">
            View all ({all.length})
          </Link>
        ) : null}
      </div>
      {!list.length ? <p className="gpc-muted">No runs yet. Try a dry run to see what would happen.</p> : null}
      <div className={full ? "gpc-runs gpc-runs-full" : "gpc-runs"}>
        {list.map((r) => (
          <div key={r.id}>
            <div className="gpc-run-line">
              <button type="button" className={`gpc-run-row${openId === r.id ? " open" : ""}`} onClick={() => setOpenId(openId === r.id ? null : r.id)}>
                <span>#{r.id}</span>
                <StatusBadge status={r.status} />
                <span>{r.dry_run ? "dry run" : r.trigger}</span>
                <span className="gpc-muted">{new Date(r.started_at).toLocaleString()}</span>
                <span className="gpc-run-sum">{label(r)}</span>
              </button>
              {r.first_url ? (
                <a className="gpc-run-go" href={r.first_url} target="_blank" rel="noreferrer" title={`Open the first ${noun} this run created on WordPress`} aria-label={`Open the first ${noun} created by run ${r.id}`}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M7 17 17 7M8 7h9v9" />
                  </svg>
                </a>
              ) : (
                <span className="gpc-run-go off" aria-hidden />
              )}
            </div>
            {openId === r.id ? (
              <div className="log-stream gpc-log">
                {detail.isLoading ? "Loading…" : null}
                {detail.data?.items.map((it) => (
                  <div key={it.id} className={it.status === "created" ? "log-ok" : it.status === "error" ? "log-err" : it.status === "warn" || it.status === "skipped" ? "log-warn" : "log-info"}>
                    [{it.status}] {it.category_name ? `${it.category_name} — ` : ""}
                    {it.message}
                    {it.ref_url ? (
                      <>
                        {" "}
                        <a href={it.ref_url} target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>
                          open ↗
                        </a>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
