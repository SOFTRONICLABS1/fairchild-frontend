"use client";

import { useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { getDisplayMessage } from "@/lib/api/errors";
import {
  automationApi,
  type CalendarFull,
  type CalendarItem,
  type CalendarParsed,
  type CalendarState,
  type ScheduleResult
} from "@/lib/automation/api";

const ZONES = [
  ["America/New_York", "US Eastern"],
  ["America/Chicago", "US Central"],
  ["America/Denver", "US Mountain"],
  ["America/Los_Angeles", "US Pacific"],
  ["Asia/Kolkata", "India"],
  ["UTC", "UTC"]
];

/** Half-hour slots in 12-hour format, e.g. ["00:00","12:00 AM"] ... ["23:30","11:30 PM"]. */
const SLOTS: Array<[string, string]> = Array.from({ length: 48 }, (_, i) => {
  const h = Math.floor(i / 2);
  const m = i % 2 ? "30" : "00";
  return [`${String(h).padStart(2, "0")}:${m}`, `${h % 12 === 0 ? 12 : h % 12}:${m} ${h < 12 ? "AM" : "PM"}`];
});
const slotLabel = (v: string) => SLOTS.find(([k]) => k === v)?.[1] ?? v;

const CHIP: Record<CalendarState, { label: string; color: string }> = {
  planned: { label: "Planned", color: "#667085" },
  generating: { label: "Writing…", color: "#2e90fa" },
  generated: { label: "Drafted", color: "#f79009" },
  approved: { label: "Approved", color: "#7a5af8" },
  scheduled: { label: "Scheduled", color: "#12b76a" },
  error: { label: "Error", color: "#d92d20" }
};

const ERR = { color: "var(--error, #b42318)", marginTop: 10 } as const;

/** Upload a content plan, let Claude draft each article, review/approve them, then schedule them in WordPress. */
export default function ContentCalendar() {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [pasted, setPasted] = useState("");
  const [perWeek, setPerWeek] = useState(5);
  const [instructions, setInstructions] = useState("");
  const [dateEditId, setDateEditId] = useState<number | null>(null);
  const [batch, setBatch] = useState("");
  const [parsed, setParsed] = useState<CalendarParsed | null>(null);
  const [time, setTime] = useState("09:00");
  const [tz, setTz] = useState("America/New_York");
  const [editing, setEditing] = useState<CalendarFull | null>(null);
  const [view, setView] = useState<"preview" | "html">("preview");
  const [result, setResult] = useState<ScheduleResult | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ["calendar"],
    queryFn: automationApi.calendarList,
    refetchInterval: (q) => (q.state.data?.generating ? 3000 : false)
  });
  const items = list.data?.items ?? [];
  const count = (s: CalendarState) => items.filter((i) => i.state === s).length;
  const refresh = () => qc.invalidateQueries({ queryKey: ["calendar"] });

  const parse = useMutation({
    mutationFn: () => automationApi.calendarParse({ file: file ?? undefined, text: file ? undefined : pasted, perWeek, instructions }),
    onSuccess: (p) => {
      setParsed(p);
      setNotice(null);
      if (!batch.trim()) setBatch(file ? file.name.replace(/\.[^.]+$/, "") : `Plan ${new Date().toISOString().slice(0, 10)}`);
    }
  });
  const importPlan = useMutation({
    mutationFn: () => automationApi.calendarImport({ batch: batch.trim() || "Plan", guidelines: parsed?.guidelines ?? "", articles: parsed?.articles ?? [] }),
    onSuccess: (r) => {
      setNotice(`Added ${r.added} article${r.added === 1 ? "" : "s"} to the calendar${r.skipped ? ` (${r.skipped} already there, skipped)` : ""}.`);
      setParsed(null);
      setFile(null);
      setPasted("");
      setInstructions("");
      setBatch("");
      if (fileRef.current) fileRef.current.value = "";
      refresh();
    }
  });
  const generate = useMutation({
    mutationFn: (ids?: number[]) => automationApi.calendarGenerate(ids),
    onSuccess: (r) => {
      setNotice(r.queued ? `Writing ${r.queued} article${r.queued === 1 ? "" : "s"}. This takes about 20 seconds each; you can keep working.` : "Nothing to write.");
      refresh();
    }
  });
  const deletePlan = useMutation({
    mutationFn: (name: string) => automationApi.calendarDeletePlan(name),
    onSuccess: (r) => {
      setNotice(`Plan deleted (${r.deleted} article${r.deleted === 1 ? "" : "s"} removed from the calendar).`);
      setEditing(null);
      refresh();
    }
  });
  const approve = useMutation({ mutationFn: (ids?: number[]) => automationApi.calendarApprove(ids), onSuccess: refresh });
  const edit = useMutation({
    mutationFn: (v: { id: number; body: Parameters<typeof automationApi.calendarEdit>[1] }) => automationApi.calendarEdit(v.id, v.body),
    onSuccess: refresh
  });
  const remove = useMutation({ mutationFn: (id: number) => automationApi.calendarDelete(id), onSuccess: refresh });
  const schedule = useMutation({
    mutationFn: () => automationApi.calendarSchedule({ time, timezone: tz }),
    onSuccess: (r) => {
      setResult(r);
      refresh();
    }
  });
  const publishNow = useMutation({
    mutationFn: async (row: CalendarFull) => {
      await automationApi.calendarEdit(row.id, { title: row.title, excerpt: row.excerpt, content: row.content, publish_date: row.publish_date, publish_time: row.publish_time });
      return automationApi.calendarPublishNow(row.id);
    },
    onSuccess: (r) => {
      setEditing(null);
      setNotice(`Published now: ${r.title}`);
      refresh();
    }
  });
  const open = useMutation({
    mutationFn: (id: number) => automationApi.calendarGet(id),
    onSuccess: (row) => {
      setEditing(row);
      setView("preview");
    }
  });

  const patchParsed = (i: number, p: Partial<CalendarParsed["articles"][number]>) =>
    setParsed((cur) => (cur ? { ...cur, articles: cur.articles.map((a, j) => (j === i ? { ...a, ...p } : a)) } : cur));
  const canRead = !parse.isPending && (file !== null || pasted.trim().length > 20);
  const busy = list.data?.generating === true;
  const pastDue = items.some((i) => i.state === "approved" && i.publish_date <= new Date().toISOString().slice(0, 10));

  return (
    <section className="card gpc-section">
      <div className="gpc-section-head">
        <span className="gpc-step">▦</span>
        <div>
          <h3>Content calendar</h3>
          <p>Upload a content plan (PDF, Word, CSV or text). Claude reads the titles and dates, writes each article, you approve them, and WordPress publishes each one on its date.</p>
        </div>
      </div>

      {notice ? <p className="gpc-muted" style={{ marginBottom: 12, color: "#067647" }}>{notice}</p> : null}
      {result ? (
        <div role="status" style={{ marginBottom: 16, padding: "14px 16px", borderRadius: 12, border: "1px solid #12b76a55", background: "#12b76a14" }}>
          <strong>✓ {result.scheduled} article{result.scheduled === 1 ? "" : "s"} scheduled in WordPress</strong>
          {result.published_now ? <div className="gpc-muted">{result.published_now} had a date that already passed and went live now.</div> : null}
          {result.failed.length ? (
            <div className="gpc-muted" style={{ color: "var(--error, #b42318)" }}>
              {result.failed.length} failed: {result.failed.map((f) => `${f.title} (${f.error})`).join("; ")}
            </div>
          ) : null}
          <button type="button" className="btn-secondary btn-sm" style={{ marginTop: 8 }} onClick={() => setResult(null)}>
            Dismiss
          </button>
        </div>
      ) : null}

      {/* 1. upload */}
      {!parsed ? (
        <>
          <label className="gpc-label">
            Upload plan
            <input
              ref={fileRef}
              className="field"
              type="file"
              accept=".pdf,.docx,.csv,.txt,.tsv,.md"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          {!file ? (
            <label className="gpc-label" style={{ marginTop: 12 }}>
              …or paste the plan
              <textarea className="field" rows={4} value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste titles, keywords and dates here" />
            </label>
          ) : null}
          <label className="gpc-label" style={{ marginTop: 12 }}>
            Instructions for Claude (optional)
            <textarea
              className="field"
              rows={2}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g. Start on Dec 1, post Monday, Wednesday and Friday only. Skip the local city articles. Put holiday topics first."
            />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginTop: 12 }}>
            <label className="gpc-label" style={{ margin: 0 }}>
              Posts per week (if the plan has no dates)
              <input className="field" type="number" min={1} max={5} value={perWeek} onChange={(e) => setPerWeek(Math.min(5, Math.max(1, Number(e.target.value) || 5)))} style={{ width: 90 }} />
            </label>
            <button className="btn btn-primary" disabled={!canRead} onClick={() => parse.mutate()}>
              {parse.isPending ? "Reading plan…" : "Read plan"}
            </button>
          </div>
          {parse.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(parse.error)}</p> : null}
        </>
      ) : (
        <>
          <p className="gpc-muted" style={{ marginBottom: 8 }}>
            Claude found {parsed.articles.length} articles. Fix anything that looks wrong, then add them to the calendar. Nothing is written or published yet.
          </p>
          <label className="gpc-label" style={{ marginBottom: 10 }}>
            Batch name
            <input className="field" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </label>
          <div style={{ maxHeight: 320, overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <tbody>
                {parsed.articles.map((a, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--border)" }}>
                    <td style={{ padding: 6, width: 140 }}>
                      <input className="field" type="date" value={a.publish_date} onChange={(e) => patchParsed(i, { publish_date: e.target.value })} />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input className="field" value={a.title} onChange={(e) => patchParsed(i, { title: e.target.value })} />
                    </td>
                    <td style={{ padding: 6, width: 190 }}>
                      <input className="field" value={a.keyword} placeholder="keyword" onChange={(e) => patchParsed(i, { keyword: e.target.value })} />
                    </td>
                    <td style={{ padding: 6, width: 40 }}>
                      <button type="button" className="btn-secondary btn-sm" aria-label="Remove" onClick={() => setParsed((c) => (c ? { ...c, articles: c.articles.filter((_, j) => j !== i) } : c))}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {parsed.guidelines ? <p className="gpc-muted" style={{ marginTop: 8 }}>Plan rules Claude will follow: {parsed.guidelines}</p> : null}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button className="btn btn-primary" disabled={importPlan.isPending || parsed.articles.length === 0 || parsed.articles.some((a) => !a.title.trim() || !a.publish_date)} onClick={() => importPlan.mutate()}>
              {importPlan.isPending ? "Adding…" : `Add ${parsed.articles.length} to calendar`}
            </button>
            <button className="btn-secondary" onClick={() => setParsed(null)}>
              Cancel
            </button>
          </div>
          {parsed.articles.some((a) => !a.publish_date) ? <p className="gpc-muted" style={ERR}>Every article needs a date.</p> : null}
          {importPlan.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(importPlan.error)}</p> : null}
        </>
      )}

      {/* 2. calendar */}
      {items.length ? (
        <>
          <div className="gpc-sep" />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 10 }}>
            <span className="gpc-muted" style={{ flex: 1, minWidth: 220 }}>
              {items.length} articles · {count("planned") + count("error")} to write · {count("generated")} to review · {count("approved")} approved · {count("scheduled")} scheduled
            </span>
            <button className="btn btn-primary btn-sm" disabled={busy || generate.isPending || count("planned") + count("error") === 0} onClick={() => generate.mutate(undefined)}>
              {busy ? "Writing…" : `Write ${count("planned") + count("error")} drafts`}
            </button>
            <button className="btn-secondary btn-sm" disabled={approve.isPending || count("generated") === 0} onClick={() => approve.mutate(undefined)}>
              Approve all drafted ({count("generated")})
            </button>
          </div>
          {generate.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(generate.error)}</p> : null}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            {Array.from(new Set(items.map((i) => i.batch))).map((name) => {
              const mine = items.filter((i) => i.batch === name);
              const live = mine.filter((i) => i.state === "scheduled").length;
              return (
                <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "4px 6px 4px 12px", border: "1px solid var(--border)", borderRadius: 999, fontSize: 12.5 }}>
                  <strong>{name}</strong> <span className="gpc-muted">{mine.length} articles</span>
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    disabled={busy || deletePlan.isPending}
                    onClick={() => {
                      const msg = live
                        ? `Delete the plan "${name}" from this app? ${live} article${live === 1 ? " is" : "s are"} already in WordPress and will stay there (remove them in WordPress if you don't want them).`
                        : `Delete the plan "${name}" and its ${mine.length} articles? This can't be undone.`;
                      if (window.confirm(msg)) deletePlan.mutate(name);
                    }}
                  >
                    🗑 Delete plan
                  </button>
                </span>
              );
            })}
          </div>
          {deletePlan.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(deletePlan.error)}</p> : null}

          <div style={{ overflow: "auto", border: "1px solid var(--border)", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: "left", background: "var(--surface-2, #f5f5f5)" }}>
                  <th style={{ padding: 8 }}>Date</th>
                  <th style={{ padding: 8 }}>Article</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }} />
                </tr>
              </thead>
              <tbody>
                {items.map((it: CalendarItem) => (
                  <tr key={it.id} style={{ borderTop: "1px solid var(--border)", verticalAlign: "top" }}>
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      {dateEditId === it.id ? (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                          <input className="field" type="date" value={it.publish_date} onChange={(e) => e.target.value && edit.mutate({ id: it.id, body: { publish_date: e.target.value } })} />
                          <select className="field" value={it.publish_time} onChange={(e) => edit.mutate({ id: it.id, body: { publish_time: e.target.value } })}>
                            <option value="">Default ({slotLabel(time)})</option>
                            {SLOTS.map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                          <button type="button" className="btn-secondary btn-sm" onClick={() => setDateEditId(null)}>
                            Done
                          </button>
                        </div>
                      ) : (
                        <>
                          {it.publish_date}
                          <div className="gpc-muted">{it.publish_time ? slotLabel(it.publish_time) : `${slotLabel(time)} (default)`}</div>
                          {it.state !== "generating" ? (
                            <button type="button" className="btn-secondary btn-sm" style={{ marginTop: 4 }} aria-label="Edit date and time" onClick={() => setDateEditId(it.id)}>
                              ✎ Edit
                            </button>
                          ) : null}
                        </>
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <div>{it.title}</div>
                      <div className="gpc-muted">
                        {it.keyword}
                        {it.needs_fact_check ? " · ⚠ fact-check places, prices and dates" : ""}
                      </div>
                      {it.error ? <div className="gpc-muted" style={{ color: "var(--error, #b42318)" }}>{it.error}</div> : null}
                    </td>
                    <td style={{ padding: 8, whiteSpace: "nowrap" }}>
                      <span style={{ color: CHIP[it.state].color, fontWeight: 600 }}>
                        {it.state === "scheduled" && it.scheduled_for === "now" ? "Published" : CHIP[it.state].label}
                      </span>
                    </td>
                    <td style={{ padding: 8, whiteSpace: "nowrap", textAlign: "right" }}>
                      {it.has_content ? (
                        <button className="btn-secondary btn-sm" disabled={open.isPending} onClick={() => open.mutate(it.id)}>
                          Preview / edit
                        </button>
                      ) : null}{" "}
                      {it.state === "generated" ? (
                        <button className="btn btn-primary btn-sm" onClick={() => edit.mutate({ id: it.id, body: { state: "approved" } })}>
                          Approve
                        </button>
                      ) : null}
                      {it.state === "approved" ? (
                        <button className="btn-secondary btn-sm" onClick={() => edit.mutate({ id: it.id, body: { state: "generated" } })}>
                          Unapprove
                        </button>
                      ) : null}
                      {it.state === "planned" || it.state === "error" || it.state === "generated" ? (
                        <>
                          {" "}
                          <button className="btn-secondary btn-sm" disabled={busy} onClick={() => generate.mutate([it.id])}>
                            {it.state === "generated" ? "Rewrite" : "Write"}
                          </button>
                        </>
                      ) : null}
                      {it.link && it.state === "scheduled" ? (
                        <a className="btn-secondary btn-sm" href={it.link} target="_blank" rel="noreferrer">
                          Open ↗
                        </a>
                      ) : null}
                      {it.state !== "scheduled" && it.state !== "generating" ? (
                        <>
                          {" "}
                          <button
                            className="btn-secondary btn-sm"
                            aria-label="Delete"
                            onClick={() => {
                              if (window.confirm(`Delete "${it.title}" from the calendar? This can't be undone.`)) remove.mutate(it.id);
                            }}
                          >
                            ✕
                          </button>
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* 3. schedule */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end", marginTop: 14 }}>
            <label className="gpc-label" style={{ margin: 0 }}>
              Default publish time
              <select className="field" value={time} onChange={(e) => setTime(e.target.value)}>
                {SLOTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <label className="gpc-label" style={{ margin: 0 }}>
              Timezone
              <select className="field" value={tz} onChange={(e) => setTz(e.target.value)}>
                {ZONES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            <button className="btn btn-primary btn-lg" disabled={schedule.isPending || count("approved") === 0} onClick={() => schedule.mutate()}>
              {schedule.isPending ? "Scheduling…" : `Schedule ${count("approved")} approved`}
            </button>
          </div>
          {pastDue ? <p className="gpc-muted" style={{ marginTop: 8 }}>Articles whose date and time have already passed will be published immediately.</p> : null}
          {schedule.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(schedule.error)}</p> : null}
        </>
      ) : null}

      {/* review / edit panel */}
      {editing ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Review article"
          onClick={(e) => {
            if (e.target === e.currentTarget) setEditing(null);
          }}
          style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,24,40,0.55)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
        >
          <div className="card" style={{ width: "min(900px, 100%)", maxHeight: "92vh", overflow: "auto", padding: 20, background: "var(--surface, #fff)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <strong>Review article · {editing.publish_date}</strong>
            <button type="button" className="btn-secondary btn-sm" aria-label="Close" onClick={() => setEditing(null)}>
              ✕
            </button>
          </div>
          <label className="gpc-label">
            Title
            <input className="field" value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          </label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
            <label className="gpc-label" style={{ margin: 0 }}>
              Publish date
              <input className="field" type="date" value={editing.publish_date} onChange={(e) => setEditing({ ...editing, publish_date: e.target.value })} />
            </label>
            <label className="gpc-label" style={{ margin: 0 }}>
              Publish time
              <select className="field" value={editing.publish_time} onChange={(e) => setEditing({ ...editing, publish_time: e.target.value })}>
                <option value="">Default ({slotLabel(time)})</option>
                {SLOTS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="gpc-label" style={{ marginTop: 12 }}>
            Meta description ({editing.excerpt.length} characters, aim for 140-155)
            <textarea className="field" rows={2} value={editing.excerpt} onChange={(e) => setEditing({ ...editing, excerpt: e.target.value })} />
          </label>
          <div style={{ display: "flex", gap: 8, margin: "14px 0 8px" }} role="tablist">
            <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "btn btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setView("preview")}>
              Preview
            </button>
            <button type="button" role="tab" aria-selected={view === "html"} className={view === "html" ? "btn btn-primary btn-sm" : "btn-secondary btn-sm"} onClick={() => setView("html")}>
              Edit HTML
            </button>
          </div>
          {view === "preview" ? (
            <iframe
              title="Article preview"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui,sans-serif;color:#222;margin:16px}h2{margin-top:1.4em}img{max-width:100%}</style><h1 style="font-size:26px">${editing.title.replace(/</g, "&lt;")}</h1>${editing.content}`}
              style={{ width: "100%", height: 420, border: "1px solid var(--border, #ddd)", borderRadius: 10, background: "#fff" }}
            />
          ) : (
            <textarea className="field" rows={18} value={editing.content} onChange={(e) => setEditing({ ...editing, content: e.target.value })} style={{ fontFamily: "monospace", fontSize: 13 }} />
          )}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
            {(["save", "approve"] as const).map((kind) => (
              <button
                key={kind}
                className={kind === "approve" ? "btn btn-primary" : "btn-secondary"}
                disabled={edit.isPending || publishNow.isPending || !editing.title.trim() || !editing.content.trim() || !editing.publish_date}
                onClick={() =>
                  edit.mutate(
                    {
                      id: editing.id,
                      body: { title: editing.title, excerpt: editing.excerpt, content: editing.content, publish_date: editing.publish_date, publish_time: editing.publish_time, ...(kind === "approve" ? { state: "approved" as const } : {}) }
                    },
                    { onSuccess: () => setEditing(null) }
                  )
                }
              >
                {kind === "approve" ? "Save & approve" : "Save changes"}
              </button>
            ))}
            <button
              className="btn"
              style={{ background: "#12b76a", color: "#fff" }}
              disabled={edit.isPending || publishNow.isPending || !editing.title.trim() || !editing.content.trim()}
              onClick={() => {
                if (window.confirm("Publish this article on the website right now, ignoring its planned date?")) publishNow.mutate(editing);
              }}
            >
              {publishNow.isPending ? "Publishing…" : "Publish now"}
            </button>
            <button className="btn-secondary" onClick={() => setEditing(null)}>
              Close
            </button>
          </div>
          {publishNow.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(publishNow.error)}</p> : null}
          {edit.isError ? <p className="gpc-muted" style={ERR}>{getDisplayMessage(edit.error)}</p> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
