"use client";

import { use } from "react";
import { notFound } from "next/navigation";
import TopNav, { NavButton } from "@/components/flow/top-nav";
import RunHistory from "../../run-history";

export default function GpcHistoryPage({ params }: { params: Promise<{ kind: string }> }) {
  const { kind } = use(params);
  if (kind !== "product" && kind !== "blog") notFound();
  return (
    <>
      <TopNav right={<NavButton href="/gpc" label="Back to automation" />} />
      <div className="page-wrap">
        <div className="gpc-wrap">
          <RunHistory kind={kind} full />
        </div>
      </div>
    </>
  );
}
