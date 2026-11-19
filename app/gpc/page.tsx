"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import TopNav, { NavButton } from "@/components/flow/top-nav";
import { getDisplayMessage } from "@/lib/api/errors";
import RunHistory from "./run-history";
import CustomBlog from "./custom-blog";
import {
  automationApi,
  type AutomationSettings,
  type BlogSettings,
  type ProductSettings,
  type Run,
  type SourceOption
} from "@/lib/automation/api";

const TIMEZONES = ["America/Denver", "America/New_York", "America/Chicago", "America/Los_Angeles", "UTC", "Europe/London", "Asia/Kolkata"];

type Kind = "product" | "blog";
type PublishStatus = "publish" | "draft" | "pending";

/* ---------- small building blocks ---------- */

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <span className="gpc-sw">
      <input type="checkbox" role="switch" aria-label={label} checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span />
    </span>
  );
}

function SwitchRow({ title, hint, checked, onChange }: { title: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="gpc-switchrow">
      <div>
        <strong>{title}</strong>
        <small>{hint}</small>
      </div>
      <Switch checked={checked} onChange={onChange} label={title} />
    </div>
  );
}

function Section({ step, title, desc, children }: { step: number; title: string; desc: string; children: ReactNode }) {
  return (
    <section className="card gpc-section">
      <div className="gpc-section-head">
        <span className="gpc-step">{step}</span>
        <div>
          <h3>{title}</h3>
          <p>{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function NumField({
  label,
  value,
  onChange,
  hint,
  min,
  max,
  step,
  prefix,
  suffix
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  hint?: string;
  min?: number;
  max?: number;
  step?: number;
  prefix?: string;
  suffix?: string;
}) {
  return (
    <label className="gpc-label">
      {label}
      <span className={`gpc-input${prefix ? " has-prefix" : ""}${suffix ? " has-suffix" : ""}`}>
        {prefix ? <span className="gpc-affix pre">{prefix}</span> : null}
        <input
          className="field"
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(e.target.value === "" ? NaN : Number(e.target.value))}
        />
        {suffix ? <span className="gpc-affix suf">{suffix}</span> : null}
      </span>
      {hint ? <small>{hint}</small> : null}
    </label>
  );
}

function StatusChoice({ value, onChange }: { value: PublishStatus; onChange: (v: PublishStatus) => void }) {
  const options: Array<{ id: PublishStatus; title: string; hint: string }> = [
    { id: "publish", title: "Publish live", hint: "Visible on your site immediately" },
    { id: "draft", title: "Save as draft", hint: "Review it in WordPress first" },
    { id: "pending", title: "Pending review", hint: "Waits for an editor to approve" }
  ];
  return (
    <div className="gpc-choices" role="radiogroup">
      {options.map((o) => (
        <button key={o.id} type="button" role="radio" aria-checked={value === o.id} className={`gpc-choice${value === o.id ? " active" : ""}`} onClick={() => onChange(o.id)}>
          <strong>{o.title}</strong>
          <small>{o.hint}</small>
        </button>
      ))}
    </div>
  );
}

/** 12-hour time picker with dropdowns (hour, minute, AM/PM). Value is "HH:MM" in 24-hour form. */
function TimePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [hh, mm] = value.split(":").map((x) => Number(x));
  const h24 = Number.isFinite(hh) ? hh : 9;
  const minute = Number.isFinite(mm) ? mm : 0;
  const isPm = h24 >= 12;
  const hour12 = h24 % 12 === 0 ? 12 : h24 % 12;
  const emit = (h12: number, m: number, pm: boolean) => {
    const h = (h12 % 12) + (pm ? 12 : 0);
    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  };
  return (
    <span className="gpc-time">
      <select className="field" aria-label="Hour" value={hour12} onChange={(e) => emit(Number(e.target.value), minute, isPm)}>
        {Array.from({ length: 12 }, (_, i) => i + 1).map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      <b>:</b>
      <select className="field" aria-label="Minute" value={minute} onChange={(e) => emit(hour12, Number(e.target.value), isPm)}>
        {Array.from({ length: 60 }, (_, i) => i).map((m) => (
          <option key={m} value={m}>
            {String(m).padStart(2, "0")}
          </option>
        ))}
      </select>
      <select className="field" aria-label="AM or PM" value={isPm ? "PM" : "AM"} onChange={(e) => emit(hour12, minute, e.target.value === "PM")}>
        <option>AM</option>
        <option>PM</option>
      </select>
    </span>
  );
}

function ScheduleFields({ s, onChange, noun }: { s: { enabled: boolean; daily_time: string; timezone: string }; onChange: (p: Partial<{ enabled: boolean; daily_time: string; timezone: string }>) => void; noun: string }) {
  const zones = TIMEZONES.includes(s.timezone) ? TIMEZONES : [s.timezone, ...TIMEZONES];
  return (
    <div className="gpc-grid">
      <label className="gpc-label">
        Time of day
        <TimePicker value={s.daily_time} onChange={(v) => onChange({ daily_time: v })} />
        <small>When the daily {noun} run starts.</small>
      </label>
      <label className="gpc-label">
        Timezone
        <select className="field" value={s.timezone} onChange={(e) => onChange({ timezone: e.target.value })}>
          {zones.map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <small>The time above is in this timezone.</small>
      </label>
    </div>
  );
}

function SourceCard({ logo, name, hint, active, onToggle, imp }: { logo: string; name: string; hint: string; active: boolean; onToggle: () => void; imp?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={active} className={`gpc-source${active ? " active" : ""}`} onClick={onToggle}>
      <span className={`gpc-source-logo${imp ? " imp" : ""}`}>{logo}</span>
      <span>
        <b>{name}</b>
        <small>{hint}</small>
      </span>
      <span className="gpc-sw" aria-hidden>
        <span />
      </span>
    </button>
  );
}

function Checklist({ title, noun, options, selected, onChange, error }: { title: string; noun: string; options: SourceOption[]; selected: string[]; onChange: (ids: string[]) => void; error?: string | null }) {
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()));
  const toggle = (id: string) => onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  return (
    <div className="gpc-picker">
      <div className="gpc-picker-head">
        <strong>{title}</strong>
        <span className="gpc-muted">{selected.length === 0 ? `Using all ${options.length} ${noun}` : `${selected.length} of ${options.length} ${noun} chosen`}</span>
        {selected.length > 0 ? (
          <button type="button" className="btn-secondary btn-sm" onClick={() => onChange([])}>
            Use all
          </button>
        ) : null}
      </div>
      {error ? <p className="gpc-error">{error}</p> : null}
      <input className="field" placeholder={`Search ${noun}…`} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="gpc-picker-list">
        {shown.map((o) => (
          <label key={o.id}>
            <input type="checkbox" checked={selected.includes(o.id)} onChange={() => toggle(o.id)} /> {o.name}
          </label>
        ))}
        {!shown.length && !error ? <span className="gpc-muted">No matches</span> : null}
      </div>
      <span className="gpc-muted">Tick specific ones to limit the search to them. Leave everything unticked to use all.</span>
    </div>
  );
}

function ConfirmDialog({ kind, dirty, busy, onCancel, onConfirm }: { kind: Kind; dirty: boolean; busy: boolean; onCancel: () => void; onConfirm: (saveFirst: boolean) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  const what = kind === "product" ? "create live products on your WordPress site" : "publish live blog posts on your WordPress site";
  return (
    <div className="gpc-modal-back" onClick={onCancel}>
      <div className="gpc-modal" role="dialog" aria-modal="true" aria-labelledby="gpc-modal-title" onClick={(e) => e.stopPropagation()}>
        <h3 id="gpc-modal-title">Run {kind === "product" ? "product" : "blog"} automation now?</h3>
        <p>This will {what}. You can stop it at any time with the Stop button.</p>
        {dirty ? <p className="gpc-modal-warn">You have unsaved changes. A run uses the saved settings.</p> : null}
        <div className="gpc-modal-actions">
          <button className="btn-secondary btn-lg" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          {dirty ? (
            <>
              <button className="btn-secondary btn-lg" onClick={() => onConfirm(false)} disabled={busy}>
                Run with saved settings
              </button>
              <button className="btn btn-primary btn-lg" onClick={() => onConfirm(true)} disabled={busy} autoFocus>
                {busy ? "Saving…" : "Save & run"}
              </button>
            </>
          ) : (
            <button className="btn btn-primary btn-lg" onClick={() => onConfirm(false)} disabled={busy} autoFocus>
              Run now
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function LiveRun({ run, onStop, stopping }: { run: Run; onStop: () => void; stopping: boolean }) {
  const detail = useQuery({
    queryKey: ["automation-run", run.id],
    queryFn: () => automationApi.run(run.id),
    refetchInterval: 2000
  });
  const sum = (detail.data?.summary ?? run.summary) as Record<string, number | string | undefined>;
  const isProduct = run.kind === "product";
  const done = Number(isProduct ? (run.dry_run ? sum.would_create : sum.created) ?? 0 : (run.dry_run ? sum.would_publish : sum.published) ?? 0);
  const target = Number(isProduct ? sum.target ?? 0 : sum.planned ?? 0);
  const pct = target ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const items = (detail.data?.items ?? []).slice(-12).reverse();
  const unit = isProduct ? "products" : "blogs";
  return (
    <section className="card gpc-live" aria-live="polite">
      <div className="gpc-live-head">
        <span className="gpc-live-dot" />
        <div style={{ flex: 1 }}>
          <strong>
            {run.dry_run ? "Dry run" : run.trigger === "schedule" ? "Scheduled run" : "Run"} #{run.id} is in progress
          </strong>
          <div className="gpc-muted">
            {target ? `${done} of ${target} ${unit}` : `${done} ${unit} so far`}
            {isProduct ? ` · ${sum.categories_done ?? 0} categories tried · ${sum.errors ?? 0} errors` : ` · ${sum.errors ?? 0} errors`}
          </div>
        </div>
        <button className="btn btn-lg gpc-stop" disabled={stopping} onClick={onStop}>
          {stopping ? "Stopping…" : "■ Stop"}
        </button>
      </div>
      <div className="gpc-progress">
        <span style={{ width: `${target ? pct : 8}%` }} className={target ? "" : "indet"} />
      </div>
      <div className="log-stream gpc-live-log">
        {!items.length ? <div className="log-info">Starting…</div> : null}
        {items.map((it) => (
          <div key={it.id} className={it.status === "created" ? "log-ok" : it.status === "error" ? "log-err" : it.status === "warn" || it.status === "skipped" ? "log-warn" : "log-info"}>
            {it.category_name ? `${it.category_name} — ` : ""}
            {it.message}
          </div>
        ))}
      </div>
    </section>
  );
}

/* ---------- page ---------- */

const IconBag = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 7h12l1 13H5L6 7Z" />
    <path d="M9 7a3 3 0 0 1 6 0" />
  </svg>
);
const IconPen = (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z" />
    <path d="m13.5 6.5 4 4" />
  </svg>
);

export default function GpcAutomationPage() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Kind>("product");
  const [form, setForm] = useState<AutomationSettings | null>(null);
  const [notice, setNotice] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [testCount, setTestCount] = useState(3);

  const settings = useQuery({ queryKey: ["automation-settings"], queryFn: automationApi.settings });
  const status = useQuery({ queryKey: ["automation-status"], queryFn: automationApi.status, refetchInterval: 20000 });
  const sources = useQuery({ queryKey: ["automation-sources"], queryFn: () => automationApi.sources(), staleTime: 10 * 60 * 1000 });
  const templates = useQuery({ queryKey: ["rf-templates"], queryFn: automationApi.templates, staleTime: 10 * 60 * 1000 });

  useEffect(() => {
    if (settings.data && !form) setForm(settings.data);
  }, [settings.data, form]);

  const firstTpl = templates.data?.[0]?.identifier;
  const tplKnown = !!form && !!templates.data?.some((x) => x.identifier === form.product.template_id);
  useEffect(() => {
    if (form && firstTpl && !tplKnown) setForm({ ...form, product: { ...form.product, template_id: firstTpl } });
  }, [form, firstTpl, tplKnown]);

  const dirty = useMemo(() => !!form && !!settings.data && JSON.stringify(form) !== JSON.stringify(settings.data), [form, settings.data]);
  const product = form?.product;
  const blog = form?.blog;
  const patchP = (p: Partial<ProductSettings>) => setForm((f) => (f ? { ...f, product: { ...f.product, ...p } } : f));
  const patchB = (p: Partial<BlogSettings>) => setForm((f) => (f ? { ...f, blog: { ...f.blog, ...p } } : f));

  const save = useMutation({
    mutationFn: (body: AutomationSettings) => automationApi.saveSettings(body),
    onSuccess: (saved) => {
      qc.setQueryData(["automation-settings"], saved);
      setForm(saved);
      void qc.invalidateQueries({ queryKey: ["automation-status"] });
      setNotice({ type: "ok", text: "Settings saved." });
    },
    onError: (e) => setNotice({ type: "err", text: getDisplayMessage(e) })
  });

  const start = useMutation({
    mutationFn: (v: { kind: Kind; dry_run: boolean; max?: number }) => automationApi.start(v.kind, { dry_run: v.dry_run, ...(v.max ? { max_categories: v.max } : {}) }),
    onSuccess: (r, v) => {
      setNotice({ type: "ok", text: `${v.dry_run ? "Dry run" : "Run"} #${r.run_id} started - watch it in Run history below.` });
      void qc.invalidateQueries({ queryKey: ["automation-runs", v.kind] });
    },
    onError: (e) => setNotice({ type: "err", text: getDisplayMessage(e) })
  });

  const runs = useQuery({
    queryKey: ["automation-runs", tab],
    queryFn: () => automationApi.runs(tab),
    refetchInterval: (q) => ((q.state.data ?? []).some((r) => r.status === "running") ? 3000 : 15000)
  });
  const runningRun = runs.data?.find((r) => r.status === "running");

  const stop = useMutation({
    mutationFn: (id: number) => automationApi.cancel(id),
    onSuccess: (r) => {
      setNotice({ type: "ok", text: `Stopping run #${r.run_id}…` });
      void qc.invalidateQueries({ queryKey: ["automation-runs", tab] });
    },
    onError: (e) => setNotice({ type: "err", text: getDisplayMessage(e) })
  });

  const sync = useMutation({
    mutationFn: automationApi.syncCategories,
    onSuccess: (r) => {
      setNotice({ type: "ok", text: `Category list refreshed: ${r.total} categories, ${r.leaf_count} end categories.` });
      void qc.invalidateQueries({ queryKey: ["automation-status"] });
    },
    onError: (e) => setNotice({ type: "err", text: getDisplayMessage(e) })
  });

  // "Run now" asks for confirmation in an on-page dialog (not the browser's alert box).
  const [confirmKind, setConfirmKind] = useState<Kind | null>(null);
  const runReal = (kind: Kind) => setConfirmKind(kind);
  const confirmRun = async (saveFirst: boolean) => {
    const kind = confirmKind;
    if (!kind) return;
    try {
      if (saveFirst && form) await save.mutateAsync(form);
    } catch {
      return; // the save error is already shown as a notice
    }
    setConfirmKind(null);
    start.mutate({ kind, dry_run: false });
  };

  const snap = status.data?.categories;
  const total = snap?.leaf_count ?? 0;
  const cycle = total ? Math.round(((status.data?.product_cursor ?? 0) / total) * 100) : 0;
  const next = status.data?.[tab];
  const nextText = next ? (next.enabled ? `${next.retrying ? "Last attempt failed - retrying at" : "Next run:"} ${next.next_run_local.replace("T", " ")} (${next.timezone})` : "Automatic runs are off - use Run now, or switch this on.") : "";
  const perDay = product ? product.categories_per_day * product.products_per_category : 0;
  const tplList = templates.data ?? [];

  const actionBar = (kind: Kind) => (
    <div className="gpc-bar">
      <span className="gpc-bar-state">
        <span className={`gpc-dot ${dirty ? "dirty" : "ok"}`} />
        {runningRun ? `Run #${runningRun.id} is in progress…` : dirty ? "You have unsaved changes" : "All changes saved"}
      </span>
      {kind === "product" ? (
        <label className="gpc-inline">
          Test with
          <input className="field gpc-mini" type="number" min={1} max={50} value={testCount} onChange={(e) => setTestCount(Math.max(1, Number(e.target.value) || 1))} />
          categories
        </label>
      ) : null}
      {runningRun ? (
        <button className="btn btn-lg gpc-stop" disabled={stop.isPending} onClick={() => stop.mutate(runningRun.id)} title="Stops the run that is in progress. Work already done is kept.">
          {stop.isPending ? "Stopping…" : `■ Stop run #${runningRun.id}`}
        </button>
      ) : (
        <>
          <button className="btn-secondary btn-lg" disabled={start.isPending} onClick={() => start.mutate({ kind, dry_run: true, ...(kind === "product" ? { max: testCount } : {}) })} title="Shows what would be posted, without posting anything">
            Dry run
          </button>
          <button className="btn-secondary btn-lg" disabled={start.isPending} onClick={() => runReal(kind)} title="Runs right now using the saved settings">
            Run now
          </button>
        </>
      )}
      <button className="btn btn-primary btn-lg" disabled={!dirty || save.isPending} onClick={() => form && save.mutate(form)}>
        {save.isPending ? "Saving…" : "Save settings"}
      </button>
    </div>
  );

  return (
    <>
      <TopNav right={<NavButton href="/search" label="Back" />} />
      <div className="page-wrap">
        <div className="gpc-wrap">
          <div className="agency-hero agency-header-card mb-6">
            <div>
              <p className="agency-kicker">GPC Website Automation</p>
              <h1 className="agency-title">Daily product &amp; blog automation</h1>
              <p className="agency-copy">Finds discounted CJ + Impact deals for your WordPress categories, lets Claude review them, and posts them for you every day.</p>
            </div>
          </div>

          {notice ? (
            <div className={`status-banner ${notice.type === "ok" ? "done" : "idle"} gpc-notice`} role="status" onClick={() => setNotice(null)}>
              {notice.text}
            </div>
          ) : null}
          {settings.isError ? <p className="gpc-error">Could not load settings: {getDisplayMessage(settings.error)}</p> : null}

          <div className="gpc-mode" data-mode={tab} role="tablist">
            <span className="gpc-mode-thumb" />
            <button role="tab" aria-selected={tab === "product"} className={tab === "product" ? "active" : ""} onClick={() => setTab("product")}>
              <span className="gpc-mode-ico">{IconBag}</span>
              <span>
                <strong>Products</strong>
                <small>Add discounted products to your shop</small>
              </span>
            </button>
            <button role="tab" aria-selected={tab === "blog"} className={tab === "blog" ? "active" : ""} onClick={() => setTab("blog")}>
              <span className="gpc-mode-ico">{IconPen}</span>
              <span>
                <strong>Blogs</strong>
                <small>Publish blog posts about your categories</small>
              </span>
            </button>
          </div>

          {!form ? (
            <p className="gpc-muted">{settings.isError ? "" : "Loading settings…"}</p>
          ) : tab === "product" && product ? (
            <>
              {runningRun ? <LiveRun run={runningRun} onStop={() => stop.mutate(runningRun.id)} stopping={stop.isPending} /> : null}
              <div className="card gpc-strip">
                <div className="gpc-strip-main">
                  <Switch checked={product.enabled} onChange={(v) => patchP({ enabled: v })} label="Run product automation every day" />
                  <div>
                    <div className="gpc-strip-title">{product.enabled ? "Product automation is ON" : "Product automation is OFF"}</div>
                    <div className="gpc-strip-sub">{nextText}</div>
                  </div>
                </div>
                <div className="gpc-chips">
                  <span className="gpc-chip">
                    <b>{snap?.missing ? "–" : (snap?.leaf_count ?? "…")}</b> end categories
                  </span>
                  <span className="gpc-chip">
                    Cycle <b>{cycle}%</b> done
                  </span>
                  <button className="btn-secondary btn-sm" disabled={sync.isPending} onClick={() => sync.mutate()} title="Re-reads the category tree from WordPress">
                    {sync.isPending ? "Refreshing…" : "Refresh categories"}
                  </button>
                </div>
              </div>

              <Section step={1} title="When and how much" desc="Pick the daily start time and how many products to add each day.">
                <ScheduleFields s={product} onChange={patchP} noun="product" />
                <div className="gpc-sep" />
                <div className="gpc-grid">
                  <NumField label="Categories per day" value={product.categories_per_day} min={1} max={5000} onChange={(v) => patchP({ categories_per_day: v })} hint={`Each day it moves on to the next ones, so all ${total || "…"} end categories get covered over time.`} />
                  <NumField label="Products per category" value={product.products_per_category} min={1} max={10} onChange={(v) => patchP({ products_per_category: v })} hint="How many deals to add in each category." />
                </div>
                <p className="gpc-muted" style={{ marginTop: 10 }}>
                  That is up to <b>{Number.isFinite(perDay) ? perDay : "…"}</b> new products per day.
                </p>
                {perDay > 400 ? <p className="gpc-error">That is a lot - expect long runs and high Claude/API usage.</p> : null}
              </Section>

              <Section step={2} title="Which deals to accept" desc="Only products that pass all of these are posted.">
                <div className="gpc-grid">
                  <NumField label="Minimum discount" value={product.min_discount} min={0} max={95} suffix="%" onChange={(v) => patchP({ min_discount: v })} hint="Skip anything discounted less than this." />
                  <NumField label="Lowest price" value={product.min_price} min={0} step={0.5} prefix="$" onChange={(v) => patchP({ min_price: v })} />
                  <NumField label="Highest price" value={product.max_price} min={0} max={2000} prefix="$" onChange={(v) => patchP({ max_price: v })} hint="Never more than $2000." />
                </div>
                <div className="gpc-sep" />
                <label className="gpc-label">
                  Words to avoid
                  <textarea className="field" rows={3} value={product.ignore_keywords} onChange={(e) => patchP({ ignore_keywords: e.target.value })} placeholder="e.g. gun, ammo, knife, vape" />
                  <small>Separate with commas or new lines. A product is skipped if its title, brand or description has any of these.</small>
                </label>
                <div className="gpc-sep" />
                <SwitchRow title="Let Claude review each product" hint="Rejects products that don't fit the category and writes the title and description." checked={product.claude_review} onChange={(v) => patchP({ claude_review: v })} />
              </Section>

              <Section step={3} title="Where deals come from" desc="Turn on the networks to search. Lists are loaded live from your accounts.">
                <div className="gpc-grid">
                  <SourceCard logo="CJ" name="CJ Affiliate" hint="Search your joined advertisers" active={product.use_cj} onToggle={() => patchP({ use_cj: !product.use_cj })} />
                  <SourceCard logo="IMP" imp name="Impact" hint="Search your active campaigns" active={product.use_impact} onToggle={() => patchP({ use_impact: !product.use_impact })} />
                </div>
                {product.use_cj ? (
                  <Checklist title="CJ advertisers" noun="advertisers" options={sources.data?.cj ?? []} selected={product.cj_advertiser_ids} onChange={(ids) => patchP({ cj_advertiser_ids: ids })} error={sources.data?.cj_error ?? (sources.isError ? getDisplayMessage(sources.error) : null)} />
                ) : null}
                {product.use_impact ? (
                  <Checklist title="Impact campaigns" noun="campaigns" options={sources.data?.impact ?? []} selected={product.impact_campaign_ids} onChange={(ids) => patchP({ impact_campaign_ids: ids })} error={sources.data?.impact_error ?? null} />
                ) : null}
              </Section>

              <Section step={4} title="Product image" desc="Every product gets a branded image: its title over the product photo, using the template you pick.">
                <div className="gpc-templates" role="radiogroup" aria-label="Image template">
                  {tplList.map((t) => (
                    <button key={t.identifier} type="button" role="radio" aria-checked={product.template_id === t.identifier} className={`gpc-tpl${product.template_id === t.identifier ? " active" : ""}`} onClick={() => patchP({ template_id: t.identifier })}>
                      {t.preview ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={t.preview} alt={t.name} />
                      ) : null}
                      <span>{t.name}</span>
                    </button>
                  ))}
                </div>
                {templates.isError ? <p className="gpc-error">Could not load templates: {getDisplayMessage(templates.error)}</p> : null}
              </Section>

              <Section step={5} title="After it's created" desc="What status new products get in WordPress.">
                <StatusChoice value={product.publish_status} onChange={(v) => patchP({ publish_status: v })} />
                <p className="gpc-muted" style={{ marginTop: 10 }}>
                  New here? Start with <b>Save as draft</b>, check a few products, then switch to Publish live.
                </p>
              </Section>

              {actionBar("product")}
              <RunHistory kind="product" limit={5} />
            </>
          ) : blog ? (
            <>
              {runningRun ? <LiveRun run={runningRun} onStop={() => stop.mutate(runningRun.id)} stopping={stop.isPending} /> : null}
              <div className="card gpc-strip">
                <div className="gpc-strip-main">
                  <Switch checked={blog.enabled} onChange={(v) => patchB({ enabled: v })} label="Run blog automation every day" />
                  <div>
                    <div className="gpc-strip-title">{blog.enabled ? "Blog automation is ON" : "Blog automation is OFF"}</div>
                    <div className="gpc-strip-sub">{nextText}</div>
                  </div>
                </div>
              </div>

              <CustomBlog />

              <Section step={1} title="When and how many" desc="Pick the daily start time and how many blog posts to publish each day.">
                <ScheduleFields s={blog} onChange={patchB} noun="blog" />
                <div className="gpc-sep" />
                <div className="gpc-grid">
                  <NumField label="Blogs per day" value={blog.blogs_per_day} min={1} max={50} onChange={(v) => patchB({ blogs_per_day: v })} hint="Each blog is about a different random category." />
                </div>
              </Section>

              <Section step={2} title="What the blogs feature" desc="Blogs link to products you already posted, so readers can buy.">
                <div className="gpc-grid">
                  <NumField label="Featured products: minimum discount" value={blog.min_discount} min={0} max={95} suffix="%" onChange={(v) => patchB({ min_discount: v })} hint="Only products with at least this discount are linked." />
                </div>
                <div className="gpc-sep" />
                <label className="gpc-label">
                  Style or topic hint for Claude (optional)
                  <textarea className="field" rows={3} value={blog.topic_hint} onChange={(e) => patchB({ topic_hint: e.target.value })} placeholder="e.g. friendly tone, focus on gift ideas and value" />
                  <small>Categories that recently got products are preferred. Otherwise Claude writes a buying guide.</small>
                </label>
              </Section>

              <Section step={3} title="After it's written" desc="What status new blog posts get in WordPress.">
                <StatusChoice value={blog.publish_status} onChange={(v) => patchB({ publish_status: v })} />
                <p className="gpc-muted" style={{ marginTop: 10 }}>
                  New here? Start with <b>Save as draft</b>, read a couple of posts, then switch to Publish live.
                </p>
              </Section>

              {actionBar("blog")}
              <RunHistory kind="blog" limit={5} />
            </>
          ) : null}
        </div>
      </div>
      {confirmKind ? <ConfirmDialog kind={confirmKind} dirty={dirty} busy={save.isPending} onCancel={() => setConfirmKind(null)} onConfirm={(saveFirst) => void confirmRun(saveFirst)} /> : null}
    </>
  );
}
