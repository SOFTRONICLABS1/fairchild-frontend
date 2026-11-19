"use client";

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { getDisplayMessage } from "@/lib/api/errors";
import { automationApi, type CustomBlogDraft, type CustomBlogResult } from "@/lib/automation/api";

type Status = "publish" | "draft" | "pending";

const EXAMPLES = [
  "A buying guide for beginner runners: how to choose shoes, what to look for in a sale, about 600 words, friendly tone.",
  "Top 5 gift ideas under $50 for a home cook, with a short intro and a closing tip.",
  "How to spot a real discount on electronics during holiday sales."
];

/** One-off blog: write a prompt, review/edit the draft, then publish. Nothing goes live until the button is pressed. */
export default function CustomBlog() {
  const [prompt, setPrompt] = useState("");
  const [draft, setDraft] = useState<CustomBlogDraft | null>(null);
  const [view, setView] = useState<"preview" | "html">("preview");
  const [status, setStatus] = useState<Status>("publish");
  const [published, setPublished] = useState<(CustomBlogResult & { title: string }) | null>(null);

  const generate = useMutation({
    mutationFn: () => automationApi.customBlogGenerate(prompt.trim()),
    onSuccess: (d) => {
      setDraft(d);
      setPublished(null);
      setView("preview");
    }
  });
  const publish = useMutation({
    mutationFn: () => automationApi.customBlogPublish({ ...(draft as CustomBlogDraft), status }),
    onSuccess: (r) => {
      // Published: show the confirmation and clear the draft + prompt so the card is ready for the next post.
      setPublished({ ...r, title: draft?.title ?? "" });
      setDraft(null);
      setPrompt("");
      setView("preview");
    }
  });

  const edit = (p: Partial<CustomBlogDraft>) => {
    setDraft((d) => (d ? { ...d, ...p } : d));
  };
  const canPublish = !!draft && draft.title.trim() !== "" && draft.content.trim() !== "" && !publish.isPending && !generate.isPending;

  return (
    <section className="card gpc-section">
      <div className="gpc-section-head">
        <span className="gpc-step">+</span>
        <div>
          <h3>Create a custom blog</h3>
          <p>Describe the post you want. Claude writes a draft, you review and edit it, then publish. Nothing is posted until you press Publish.</p>
        </div>
      </div>

      {published ? (
        <div
          role="status"
          style={{
            display: "flex", flexWrap: "wrap", alignItems: "center", gap: 12, marginBottom: 16, padding: "14px 16px",
            borderRadius: 12, border: "1px solid #12b76a55", background: "#12b76a14"
          }}
        >
          <span aria-hidden style={{ fontSize: 22, color: "#12b76a" }}>✓</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <strong>{published.status === "publish" ? "Published!" : published.status === "draft" ? "Saved as draft in WordPress" : "Sent for review"}</strong>
            <div className="gpc-muted">{published.title}</div>
          </div>
          {published.link ? (
            <a className="btn-secondary btn-sm" href={published.link} target="_blank" rel="noreferrer">
              {published.status === "publish" ? "View post ↗" : "Open in WordPress ↗"}
            </a>
          ) : null}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setPublished(null)} aria-label="Dismiss">
            Dismiss
          </button>
        </div>
      ) : null}

      <label className="gpc-label">
        Your prompt
        <textarea
          className="field"
          rows={5}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. Write a buying guide for beginner runners, friendly tone, about 600 words, end with 3 quick tips."
        />
      </label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "10px 0" }}>
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" className="btn-secondary btn-sm" onClick={() => setPrompt(ex)} title={ex}>
            {ex.length > 44 ? `${ex.slice(0, 44)}…` : ex}
          </button>
        ))}
      </div>
      <button className="btn btn-primary" disabled={prompt.trim().length < 5 || generate.isPending} onClick={() => generate.mutate()}>
        {generate.isPending ? "Writing…" : draft ? "Regenerate draft" : "Generate draft"}
      </button>
      {generate.isError ? <p className="gpc-muted" style={{ color: "var(--error, #b42318)", marginTop: 10 }}>{getDisplayMessage(generate.error)}</p> : null}

      {draft ? (
        <>
          <div className="gpc-sep" />
          <label className="gpc-label">
            Title
            <input className="field" value={draft.title} onChange={(e) => edit({ title: e.target.value })} />
          </label>
          <label className="gpc-label" style={{ marginTop: 12 }}>
            Summary (excerpt)
            <textarea className="field" rows={2} value={draft.excerpt} onChange={(e) => edit({ excerpt: e.target.value })} />
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
              title="Blog preview"
              sandbox=""
              srcDoc={`<!doctype html><meta charset="utf-8"><style>body{font:16px/1.6 system-ui,sans-serif;color:#222;margin:16px}h2{margin-top:1.4em}img{max-width:100%}</style><h1 style="font-size:26px">${draft.title.replace(/</g, "&lt;")}</h1>${draft.content}`}
              style={{ width: "100%", height: 420, border: "1px solid var(--border, #ddd)", borderRadius: 10, background: "#fff" }}
            />
          ) : (
            <textarea className="field" rows={16} value={draft.content} onChange={(e) => edit({ content: e.target.value })} style={{ fontFamily: "monospace", fontSize: 13 }} />
          )}

          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginTop: 14 }}>
            <label className="gpc-label" style={{ margin: 0 }}>
              When published
              <select className="field" value={status} onChange={(e) => setStatus(e.target.value as Status)}>
                <option value="publish">Publish live</option>
                <option value="draft">Save as draft in WordPress</option>
                <option value="pending">Pending review</option>
              </select>
            </label>
            <button className="btn btn-primary btn-lg" disabled={!canPublish} onClick={() => publish.mutate()}>
              {publish.isPending ? "Publishing…" : status === "publish" ? "Publish blog" : "Save to WordPress"}
            </button>
          </div>
          {publish.isError ? <p className="gpc-muted" style={{ color: "var(--error, #b42318)", marginTop: 10 }}>{getDisplayMessage(publish.error)}</p> : null}
        </>
      ) : null}
    </section>
  );
}
