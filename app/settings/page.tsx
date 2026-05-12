"use client";

import { useState } from "react";
import TopNav, { NavButton } from "@/components/flow/top-nav";

function Field({
  label,
  value,
  placeholder,
  password = false
}: {
  label: string;
  value?: string;
  placeholder?: string;
  password?: boolean;
}) {
  const [showSecret, setShowSecret] = useState(false);
  const isSecretVisible = password && showSecret;

  return (
    <div>
      <label className="mb-1 block text-[12px] text-slate-600">{label}</label>
      <div className="flex items-center gap-2">
        <input
          className="field !h-9 !border-slate-300 !bg-white !py-1.5 !text-slate-700"
          defaultValue={value}
          placeholder={placeholder}
          type={isSecretVisible ? "text" : password ? "password" : "text"}
        />
        {password ? (
          <button
            type="button"
            onClick={() => setShowSecret((prev) => !prev)}
            className="grid h-9 w-12 place-items-center rounded-md border border-slate-300 bg-white text-slate-500"
            aria-label={`${isSecretVisible ? "Hide" : "Show"} ${label}`}
            title={`${isSecretVisible ? "Hide" : "Show"} ${label}`}
          >
            {isSecretVisible ? (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 3l18 18" />
                <path d="M10.6 10.6a2 2 0 102.8 2.8" />
                <path d="M9.9 4.2A10.7 10.7 0 0112 4c5.5 0 9.4 4.2 10 8-.2 1.3-.9 2.7-2 4" />
                <path d="M6.1 6.1C4.2 7.5 2.9 9.5 2 12c.8 3.8 4.6 8 10 8a9.7 9.7 0 005.9-1.9" />
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 12s3.5-8 10-8 10 8 10 8-3.5 8-10 8-10-8-10-8z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function PlatformCard({
  title,
  subtitle,
  initials,
  connected = true,
  children
}: {
  title: string;
  subtitle: string;
  initials: string;
  connected?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="flex h-full flex-col overflow-hidden rounded-xl border border-slate-300 bg-white">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="grid h-8 w-8 place-items-center rounded-md bg-[#e8eef8] text-sm font-semibold text-[#385a8a]">{initials}</div>
          <div>
            <h3 className="text-[28px] leading-none font-medium text-slate-800" style={{ fontSize: "29px", transform: "scale(0.5)", transformOrigin: "left top", height: "16px" }}>
              {title}
            </h3>
            <p className="text-[12px] text-slate-600">{subtitle}</p>
          </div>
        </div>
        <span className={connected ? "text-sm text-[#236b1e]" : "text-sm text-slate-500"}>● {connected ? "Connected" : "Not connected"}</span>
      </div>

      <div className="flex-1 px-4 py-3">{children}</div>

      <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
        <button className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-700">↺ Test connection</button>
        <button className="rounded-lg border border-slate-300 bg-white px-5 py-2 text-sm font-medium text-slate-800">Save</button>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  return (
    <>
      <TopNav right={<NavButton href="/search" label="Back to search" />} />
      <div className="grid min-h-[calc(100vh-58px)] grid-cols-1 md:grid-cols-[190px_1fr]">
        <aside className="border-r border-slate-200 bg-white p-4">
          <div className="rounded-md bg-[#eaf2fb] px-3 py-2 text-sm font-medium text-[#21588f]">Platforms</div>
          <div className="mt-1 px-3 py-2 text-sm text-slate-500">GPT / AI</div>
          <div className="px-3 py-2 text-sm text-slate-500">Templates</div>
          <div className="px-3 py-2 text-sm text-slate-500">Image settings</div>
          <div className="px-3 py-2 text-sm text-slate-500">Notifications</div>
        </aside>

        <main className="p-4 md:p-5">
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-wide text-slate-500">Platform Connections</h2>
          <div className="grid gap-3 md:grid-cols-2">
            <PlatformCard title="CJ Affiliate" subtitle="Commission Junction" initials="CJ">
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="API key" value="cj_live_xxxxxxxxxxxx" password />
              </div>
            </PlatformCard>

            <PlatformCard title="Impact" subtitle="Impact.com partnerships" initials="IM">
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="Account SID" value="IRxxxxxxxxxx" />
                <Field label="Auth token" value="impact_xxxxxxxxxxxx" password />
              </div>
            </PlatformCard>

            <PlatformCard title="WordPress" subtitle="WordPress site connection" initials="WP">
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="Domain" value="https://yoursite.com" />
                <Field label="Consumer Key" value="ck_xxxxxxxxxxxx" />
                <Field label="Consumer Secret" value="cs_xxxxxxxxxxxx" password />
              </div>
            </PlatformCard>

            <PlatformCard title="Metricool" subtitle="Metricool publishing connection" initials="MT" connected={false}>
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="Auth Token" placeholder="Paste Metricool token" password />
              </div>
            </PlatformCard>

            <PlatformCard title="Renderform" subtitle="Renderform image API connection" initials="RF">
              <div className="grid gap-2 md:grid-cols-2">
                <Field label="API Key" value="rf_key_xxxxxxxxxxxx" password />
              </div>
            </PlatformCard>
          </div>
        </main>
      </div>
    </>
  );
}
