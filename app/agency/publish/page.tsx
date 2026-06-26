"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AgencyLogoutButton from "@/components/agency/logout-button";
import TopNav from "@/components/flow/top-nav";
import AgencyStepper from "@/components/agency/stepper";
import { loadAgencyAuth } from "@/lib/agency/auth";
import { AgencyPackage, AGENCY_TEMPLATES, loadAgencyPackages, packageCompleteness } from "@/lib/agency/mock";

export default function AgencyPublishPage() {
  const router = useRouter();
  const [packages, setPackages] = useState<AgencyPackage[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState(false);

  useEffect(() => {
    const auth = loadAgencyAuth();
    if (!auth?.accessToken) {
      router.replace("/agency/login");
      return;
    }
    setPackages(loadAgencyPackages());
  }, [router]);

  const totals = useMemo(() => {
    return {
      ready: packages.filter((item) => item.status === "Ready").length,
      review: packages.filter((item) => item.status === "Needs review").length
    };
  }, [packages]);

  const runPublish = async () => {
    setPublishing(true);
    setPublished(false);
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    setPublished(true);
    setPublishing(false);
  };

  return (
    <>
      <TopNav right={<AgencyLogoutButton />} />
      <AgencyStepper active={3} />
      <div className="page-wrap">
        <div className="mx-auto max-w-6xl">
          <div className="status-banner done">
            <div className="status-icon">✓</div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Agency workflow ready</p>
              <p className="text-sm text-slate-600">
                {published
                  ? "Publish completed for the selected location packages."
                  : "Review the location packages below before publishing."}
              </p>
            </div>
          </div>

          <div className="mb-4 grid gap-4 md:grid-cols-3">
            <div className="stat">
              <p className="text-xs text-slate-500">Locations</p>
              <p className="text-2xl font-semibold">{packages.length}</p>
            </div>
            <div className="stat">
              <p className="text-xs text-slate-500">Ready</p>
              <p className="text-2xl font-semibold">{totals.ready}</p>
            </div>
            <div className="stat">
              <p className="text-xs text-slate-500">Needs review</p>
              <p className="text-2xl font-semibold">{totals.review}</p>
            </div>
          </div>

          <div className="grid gap-4">
            {packages.map((pkg) => {
              const template = AGENCY_TEMPLATES.find((item) => item.id === pkg.selectedTemplateId) ?? AGENCY_TEMPLATES[0];
              const score = packageCompleteness(pkg);
              return (
                <div key={pkg.rowId} className="card p-4">
                  <div className="grid gap-4 lg:grid-cols-[220px_1fr_220px]">
                    <div className={`agency-preview-panel ${template.frameClass}`}>
                      <img src={pkg.imageDataUrl} alt={pkg.location} className="h-full w-full object-cover" />
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{pkg.location}</p>
                          <p className="text-xs text-slate-500">{pkg.campaignName}</p>
                        </div>
                        <span className={`prod-status-pill ${pkg.status === "Ready" ? "done" : pkg.status === "Needs review" ? "failed" : "waiting"}`}>{pkg.status}</span>
                      </div>
                      <p className="text-sm text-slate-600">{pkg.landingPageUrl}</p>
                      <div className="flex flex-wrap gap-2">
                        {pkg.keywords.slice(0, 4).map((keyword) => (
                          <span key={`${pkg.rowId}-${keyword}`} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">{keyword}</span>
                        ))}
                      </div>
                      <div className="grid gap-2 md:grid-cols-2">
                        {pkg.headlines.slice(0, 3).map((headline) => (
                          <div key={headline} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">{headline}</div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        {pkg.targetingLocations.map((location) => (
                          <span key={`${pkg.rowId}-${location}`} className="rounded-full bg-[#F3F8FE] px-3 py-1 text-xs text-[#185FA5]">
                            {location}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="agency-publish-meta">
                      <p className="text-xs uppercase tracking-wide text-slate-500">Template</p>
                      <p className="mb-3 text-sm font-medium">{template.name}</p>
                      <p className="text-xs uppercase tracking-wide text-slate-500">Readiness</p>
                      <p className="mb-3 text-sm font-medium">{score}% complete</p>
                      <p className="text-xs uppercase tracking-wide text-slate-500">CTA</p>
                      <p className="text-sm font-medium">{pkg.cta}</p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Link href="/agency/package" className="btn-secondary">Back to Campaign Package</Link>
            <button type="button" className="btn-primary" onClick={() => void runPublish()} disabled={publishing || packages.length === 0}>
              {publishing ? "Publishing..." : published ? "Published" : "Publish"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
