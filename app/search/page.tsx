"use client";
import { useState } from "react";
import Link from "next/link";
import TopNav, { NavButton } from "@/components/flow/top-nav";

function PlatformCard({ active, code, title, subtitle, tone, onClick }: { active: boolean; code: string; title: string; subtitle: string; tone: "cj" | "imp"; onClick: () => void; }) {
  return (
    <button onClick={onClick} className={`card p-4 text-left transition ${active ? "border-2 border-[#185FA5]" : ""}`}>
      <div className="mb-2 flex items-center justify-between">
        <div className={`grid h-8 w-8 place-items-center rounded-md text-xs font-semibold ${tone === "cj" ? "bg-[#E6F1FB] text-[#0C447C]" : "bg-[#EEEDFE] text-[#3C3489]"}`}>{code}</div>
        <div className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${active ? "border-[#185FA5] bg-[#185FA5] text-white" : "border-slate-300 text-slate-300"}`}>{active ? "✓" : ""}</div>
      </div>
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
    </button>
  );
}

export default function SearchPage() {
  const [cj, setCj] = useState(true);
  const [impact, setImpact] = useState(false);

  return (
    <>
      <TopNav right={<><span className="text-xs text-slate-500">All systems live</span><NavButton href="/history" label="History" /><NavButton href="/settings" label="Settings" /></>} />
      <div className="page-wrap">
        <div className="mx-auto max-w-[560px] text-center">
          <h1 className="mb-1 text-[22px] font-medium">What would you like to post today?</h1>
          <p className="mb-8 text-sm text-slate-500">Search products from your affiliate platforms and publish them in one click.</p>

          <div className="mb-5 grid grid-cols-2 gap-3">
            <PlatformCard active={cj} code="CJ" title="CJ Affiliate" subtitle="Commission Junction" tone="cj" onClick={() => setCj((v) => !v)} />
            <PlatformCard active={impact} code="IM" title="Impact" subtitle="Impact.com partnerships" tone="imp" onClick={() => setImpact((v) => !v)} />
          </div>

          <div className="card mb-4 flex items-center gap-2 px-3 py-2">
            <span className="text-slate-400">⌕</span>
            <input className="w-full border-none bg-transparent text-sm outline-none" placeholder="Search products e.g. wireless headphones..." />
            <Link href="/results" className="btn-primary">Search</Link>
          </div>

          <p className="mb-3 text-xs text-slate-500">Or ask naturally: list most discounted products in CJ or top rated electronics on Impact</p>
          <div className="mb-8 flex flex-wrap justify-center gap-2">
            <Link className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" href="/results">Most discounted in CJ</Link>
            <Link className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" href="/results">Top electronics on Impact</Link>
            <Link className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" href="/results">Best commission rate</Link>
            <Link className="rounded-full border border-slate-300 bg-white px-3 py-1 text-xs text-slate-500" href="/results">New arrivals this week</Link>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <div className="stat"><p className="text-xl font-medium">142</p><p className="text-xs text-slate-500">Posts created</p></div>
            <div className="stat"><p className="text-xl font-medium">38</p><p className="text-xs text-slate-500">Products saved</p></div>
            <div className="stat"><p className="text-xl font-medium">12</p><p className="text-xs text-slate-500">Scheduled today</p></div>
          </div>
        </div>
      </div>
    </>
  );
}
