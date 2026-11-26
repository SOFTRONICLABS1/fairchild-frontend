"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDisplayMessage } from "@/lib/api/errors";
import { automationApi, type GuideFull, type GuideSettings, type GuideState, type SourceOption } from "@/lib/automation/api";

const PAGE = 50;
const SLOTS: Array<[string, string]> = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  return [`${String(h).padStart(2, "0")}:${m}`, `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`];
});
const ZONES = [
  ["America/New_York", "US Eastern"],
  ["America/Chicago", "US Central"],
  ["America/Denver", "US Mountain"],
  ["America/Los_Angeles", "US Pacific"],
  ["UTC", "UTC"]
];
const CHIP: Record<GuideState, { label: string; color: string }> = {
  queued: { label: "Queued", color: "#667085" },
  generating: { label: "Writing…", color: "#2e90fa" },
  generated: { label: "Drafted", color: "#f79009" },
  approved: { label: "Approved", color: "#7a5af8" },
  published: { label: "Live", color: "#12b76a" },
  skipped: { label: "Skipped", color: "#667085" },
  error: { label: "Error", color: "#d92d20" }
};
const ERR = { color: "var(--error, #b42318)", marginTop: 10 } as const;

function StorePicker({ title, options, selected, onChange }: { title: string; options: SourceOption[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div style={{ flex: 1, minWidth: 260 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <strong style={{ fontSize: 13 }}>{title}</strong>
        <span className="gpc-muted">{selected.length ? `${selected.length} selected` : "none selected = all"}</span>
      </div>
      <input className="field" placeholder="Search stores (Macy's, Nordstrom, Kohl's…)" value={q} onChange={(e) => setQ(e.target.value)} />
      <div style={{ maxHeight: 150, overflow: "auto", border: "1px solid var(--border)", borderRadius: 8, marginTop: 6, padding: 6 }}>
        {shown.length === 0 ? <div className="gpc-muted">Nothing found.</div> : null}
        {shown.slice(0, 200).map((o) => (
          <label key={o.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, padding: "2px 0" }}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} />
            {o.name}
          </label>
        ))}
      </div>
    </div>
  );
}

/** One shopping guide per end-point category, written into the category page. Draft, approve a sample, then it drips out daily. */
export default function CategoryGuides() {
  const qc = useQueryClient();
  const [state, setState] = useState("");
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [draftN, setDraftN] = useState(20);
  const [cfg, setCfg] = useState<GuideSettings | null>(null);
  const [cfgDirty, setCfgDirty] = useState(false);
  const [editing, setEditing] = useState<GuideFull | null>(null);
  const [view, setView] = useState<"preview" | "html">("preview");
  const [notice, setNotice] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ["guide-settings"], queryFn: automationApi.guideSettings });
  const sources = useQuery({ queryKey: ["automation-sources"], queryFn: () => automationApi.sources(), staleTime: 10 * 60 * 1000 });
  const list = useQuery({
    queryKey: ["guides", state, q, offset],
    queryFn: () => automationApi.guideList({ state: state || undefined, q: q || undefined, limit: PAGE, offset }),
    refetchInterval: (query) => (query.state.data?.busy ? 4000 : false)
  });
  useEffect(() => {
    if (settings.data && !cfg) setCfg(settings.data);
  }, [settings.data, cfg]);

  const counts = list.data?.counts ?? {};
  const n = (s: GuideState) => counts[s] ?? 0;
  const total = Object.values(counts).reduce((a, b) => a + (b ?? 0), 0);
  const refresh = () => qc.invalidateQueries({ queryKey: ["guides"] });
  const patchCfg = (p: Partial<GuideSettings>) => {
    setCfg((c) => (c ? { ...c, ...p } : c));
    setCfgDirty(true);
  };

  const saveCfg = useMutation({
    mutationFn: () => automationApi.saveGuideSettings(cfg as GuideSettings),
    onSuccess: (s) => {
      setCfg(s);
      setCfgDirty(false);
      setNotice("Guide settings saved.");
    }
  });
  const draft = useMutation({
    mutationFn: (v: { ids?: number[]; count?: number }) => automationApi.guideGenerate(v),
    onSuccess: (r) => {
      setNotice(r.queued ? `Writing ${r.queued} guide${r.queued === 1 ? "" : "s"} in the background. Categories without enough products are skipped automatically.` : "Nothing to write.");
      refresh();
    }
  });
  const approve = useMutation({
    mutationFn: (v: { ids?: number[]; first_n?: number }) => automationApi.guideApprove(v),
    onSuccess: (r) => {
      setNotice(`Approved ${r.approved} guide${r.approved === 1 ? "" : "s"}.`);
      refresh();
    }
  });
  const runNow = useMutation({
    mutationFn: automationApi.guideRunNow,
    onSuccess: () => {
      setNotice("Daily guide run started. Check Live in a minute.");
      setTimeout(refresh, 5000);
    }
  });
  const open = useMutation({
    mutationFn: (id: number) => automationApi.guideGet(id),
    onSuccess: (g) => {
      setEditing(g);
      setView("preview");
    }
  });
  const save = useMutation({
    mutationFn: (v: { g: GuideFull; approve: boolean }) =>
      automationApi.guideEdit(v.g.category_id, { excerpt: v.g.excerpt, content: v.g.content, ...(v.approve ? { state: "approved" as const } : {}) }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    }
  });
  const publishNow = useMutation({
    mutationFn: async (g: GuideFull) => {
      await automationApi.guideEdit(g.category_id, { excerpt: g.excerpt, content: g.content });
      return automationApi.guidePublishNow(g.category_id);
    },
    onSuccess: (r) => {
      setEditing(null);
      setNotice(r.state === "published" ? `Live on the category page: ${r.path}` : `Not published: ${r.error ?? r.state}`);
      refresh();
    }
  });

  const items = list.data?.items ?? [];
  const leafTotal = list.data?.leaf_total ?? 0;
  const busy = list.data?.busy === true;

  return (
    <section className="card gpc-section">
      <div className="gpc-section-head">
        <span className="gpc-step">▤</span>
        <div>
          <h3>Category guides</h3>
          <p>A shopping helper guide for every end-point category, written into that category page. Claude drafts it from real department-store deals; you approve a sample, then it publishes a few dozen a day.</p>
        </div>
      </div>

      {notice ? <p className="gpc-muted" style={{ marginBottom: 12, color: "#067647" }}>{notice}</p> : null}

      {/* settings */}
      {cfg ? (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, alignItems: "flex-end" }}>
            <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, fontWeight: 600 }}>
              <input type="checkbox" checked={cfg.enabled} onChange={(e) => patchCfg({ enabled: e.target.checked })} />
              Daily publishing on
            </label>
            <label className="gpc-label" style={{ margin: 0 }}>
              Time
              <select className="field" value={cfg.daily_time} onChange={(e) => patchCfg({ daily_time: e.target.value })}>
                {SLOTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="gpc-label" style={{ margin: 0 }}>
              Timezone
              <select className="field" value={cfg.timezone} onChange={(e) => patchCfg({ timezone: e.target.value })}>
                {ZONES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="gpc-label" style={{ margin: 0 }}>
              Guides per day
              <input className="field" type="number" min={1} max={500} value={cfg.guides_per_day} onChange={(e) => patchCfg({ guides_per_day: Math.max(1, Number(e.target.value) || 1) })} style={{ width: 100 }} />
            </label>
          </div>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginTop: 12 }}>
            <input type="checkbox" checked={cfg.auto_publish} onChange={(e) => patchCfg({ auto_publish: e.target.checked })} style={{ marginTop: 3 }} />
            <span>
              <strong>Write and publish new guides automatically each day</strong>
              <span className="gpc-muted" style={{ display: "block" }}>
                Leave this off while you review your first sample: the daily run then only publishes guides you approved. Turn it on after you are happy with the quality.
              </span>
            </span>
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 14 }}>
            <StorePicker title="CJ stores" options={sources.data?.cj ?? []} selected={cfg.cj_advertiser_ids} onChange={(ids) => patchCfg({ cj_advertiser_ids: ids })} />
            <StorePicker title="Impact stores" options={sources.data?.impact ?? []} selected={cfg.impact_campaign_ids} onChange={(ids) => patchCfg({ impact_campaign_ids: ids })} />
          </div>
          <p className="gpc-muted" style={{ marginTop: 6 }}>
            Pick the department stores (Macy&apos;s, Nordstrom, JCPenney, Dillard&apos;s, Kohl&apos;s…). Only stores your CJ/Impact accounts have joined appear here.
          </p>
          <div style={{ marginTop: 10 }}>
            <button className="btn btn-primary btn-sm" disabled={!cfgDirty || saveCfg.isPending} onClick={() => saveCfg.mutate()}>
              {saveCfg.isPending ? "Saving…" : cfgDirty ? "Save guide settings" : "Saved"}
            </button>
          </div>
          {saveCfg.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(saveCfg.error)}</p> : null}
        </>
      ) : settings.isError ? (
        <p className="gpc-muted" style={ERR}>{getDisplayMessage(settings.error)}</p>
      ) : null}

      <div className="gpc-sep" />

      {/* progress + actions */}
      <p className="gpc-muted" style={{ marginBottom: 10 }}>
        {leafTotal.toLocaleString()} end-point categories · {n("published")} live · {n("approved")} approved · {n("generated")} to review · {n("skipped")} skipped (not enough products) · {n("error")} errors · {Math.max(0, leafTotal - total).toLocaleString()} not started
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12 }}>
        <input className="field" type="number" min={1} max={200} value={draftN} onChange={(e) => setDraftN(Math.min(200, Math.max(1, Number(e.target.value) || 1)))} style={{ width: 80 }} aria-label="How many guides to draft" />
        <button className="btn btn-primary btn-sm" disabled={busy || draft.isPending} onClick={() => draft.mutate({ count: draftN })}>
          {busy ? "Writing…" : `Draft next ${draftN}`}
        </button>
        <button className="btn-secondary btn-sm" disabled={approve.isPending || n("generated") === 0} onClick={() => approve.mutate({ first_n: draftN })}>
          Approve first {Math.min(draftN, n("generated"))} drafted
        </button>
        <button
          className="btn-secondary btn-sm"
          disabled={runNow.isPending || (n("approved") === 0 && !cfg?.auto_publish)}
          onClick={() => {
            if (window.confirm("Run today's guide publishing now? This puts guides live on the website.")) runNow.mutate();
          }}
        >
          {runNow.isPending ? "Starting…" : "Run daily job now"}
        </button>
      </div>
      {draft.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(draft.error)}</p> : null}
      {runNow.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(runNow.error)}</p> : null}

      {/* table */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
        <input
          className="field"
          placeholder="Search categories (e.g. handbags)"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOffset(0);
          }}
          style={{ flex: 1, minWidth: 200 }}
        />
        <select
          className="field"
          value={state}
          onChange={(e) => {
            setState(e.target.value);
            setOffset(0);
          }}
        >
          <option value="">All states</option>
          {(Object.keys(CHIP) as GuideState[]).map((s) => (
            <option key={s} value={s}>
              {CHIP[s].label}
            </option>
          ))}
        </select>
      </div>
      {items.length === 0 ? (
        <p className="gpc-muted">{total === 0 ? "No guides yet. Pick your stores above, save, then press Draft." : "Nothing matches."}</p>
      ) : (
        <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <tbody>
              {items.map((it) => (
                <tr key={it.category_id} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                  <td style={{ padding: 8 }}>
                    <div>{it.path}</div>
                    {it.error ? <div className="gpc-muted" style={{ color: it.state === "error" ? "var(--error, #b42318)" : undefined }}>{it.error}</div> : null}
                    {it.product_count ? <div className="gpc-muted">{it.product_count} products found</div> : null}
                  </td>
                  <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                    <span style={{ color: CHIP[it.state].color, fontWeight: 600 }}>{CHIP[it.state].label}</span>
                  </td>
                  <td style={{ padding: 8, whiteSpace: "nowrap", textAlign: "right" }}>
                    {it.has_content ? (
                      <button className="btn-secondary btn-sm" disabled={open.isPending} onClick={() => open.mutate(it.category_id)}>
                        Preview / edit
                      </button>
                    ) : null}{" "}
                    {it.state === "generated" ? (
                      <button className="btn btn-primary btn-sm" onClick={() => approve.mutate({ ids: [it.category_id] })}>
                        Approve
                      </button>
                    ) : null}
                    {it.state === "published" && it.link ? (
                      <a className="btn-secondary btn-sm" href={it.link} target="_blank" rel="noreferrer">
                        Open page ↗
                      </a>
                    ) : null}
                    {it.state === "error" || it.state === "skipped" ? (
                      <button className="btn-secondary btn-sm" disabled={busy} onClick={() => draft.mutate({ ids: [it.category_id] })}>
                        Retry
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center" }}>
        <button className="btn-secondary btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
          ← Previous
        </button>
        <button className="btn-secondary btn-sm" disabled={items.length < PAGE} onClick={() => setOffset(offset + PAGE)}>
          Next →
        </button>
        <span className="gpc-muted">Showing {items.length ? offset + 1 : 0}–{offset + items.length}</span>
      </div>

      {/* review pop-up */}
      {editing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review guide"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,24,40,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div className="card" style={{ width: "min(900px, 100%)", maxHeight: "92vh", overflow: "auto", padding: 20, background: "var(--surface, #fff)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <strong>{editing.path}</strong>
              <button type="button" className="btn-secondary btn-sm" aria-label="Close" onClick={() => setEditing(null)}>
                ✕
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, margin: "0 0 8px" }} role="tablist">
              <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "btn btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setView("preview")}>
                Preview
              </button>
              <button type="button" role="tab" aria-selected={view === "html"} className={view === "html" ? "btn btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setView("html")}>
                Edit HTML
              </button>
            </div>
            {view === "preview" ? (
              <iframe
                title="Guide preview"
                sandbox=""
                srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui,sans-serif;color:#222;margin:16px}h2{margin-top:1.4em}img{max-width:100%}</style>${editing.content}`}
                style={{ width: "100%", height: 440, border: "1px solid var(--border, #ddd)", borderRadius: 10, background: "#fff" }}
              />
            ) : (
              <textarea className="field" rows={18} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} style={{ fontFamily: "monospace", fontSize: 13 }} />
            )}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              <button className="btn-secondary" disabled={save.isPending || publishNow.isPending || !editing.content.trim()} onClick={() => save.mutate({ g: editing, approve: false })}>
                Save changes
              </button>
              <button className="btn btn-primary" disabled={save.isPending || publishNow.isPending || !editing.content.trim()} onClick={() => save.mutate({ g: editing, approve: true })}>
                Save &amp; approve
              </button>
              <button
                className="btn"
                style={{ background: "#12b76a", color: "#fff" }}
                disabled={save.isPending || publishNow.isPending || !editing.content.trim()}
                onClick={() => {
                  if (window.confirm("Put this guide live on the category page right now?")) publishNow.mutate(editing);
                }}
              >
                {publishNow.isPending ? "Publishing…" : "Publish now"}
              </button>
              <button className="btn-secondary" onClick={() => setEditing(null)}>
                Close
              </button>
            </div>
            {save.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(save.error)}</p> : null}
            {publishNow.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(publishNow.error)}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
