"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import AgencyLogoutButton from "@/components/agency/logout-button";
import TopNav from "@/components/flow/top-nav";
import AgencyStepper from "@/components/agency/stepper";
import { loadAgencyAuth } from "@/lib/agency/auth";
import { AgencyPackage, AGENCY_TEMPLATES, loadAgencyPackages, packageCompleteness } from "@/lib/agency/mock";
import { getSocialPlatform } from "@/lib/agency/social-platforms";

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
              const showGoogle = pkg.packageMode !== "social";
              const showSocial = pkg.packageMode !== "google";
              return (
                <div key={pkg.rowId} className="card p-4">
                  <div className="grid gap-4 lg:grid-cols-[220px_1fr_220px]">
                    <div className={`agency-preview-panel ${template.frameClass}`}>
                      {pkg.assetType === "video" ? (
                        <video src={pkg.assetDataUrl || pkg.imageDataUrl} className="h-full w-full object-cover" muted playsInline preload="metadata" />
                      ) : (
                        <img src={pkg.imageDataUrl} alt={pkg.location} className="h-full w-full object-cover" />
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold">{pkg.location}</p>
                          <p className="text-xs text-slate-500">{showGoogle ? pkg.campaignName : pkg.socialPostTitle}</p>
                        </div>
                        <span className={`prod-status-pill ${(showGoogle ? pkg.status : pkg.socialStatus) === "Ready" ? "done" : (showGoogle ? pkg.status : pkg.socialStatus) === "Needs review" ? "failed" : "waiting"}`}>{showGoogle ? pkg.status : pkg.socialStatus}</span>
                      </div>
                      <p className="text-sm text-slate-600">{pkg.landingPageUrl}</p>
                      {showGoogle ? (
                        <>
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
                        </>
                      ) : null}
                      {showSocial ? (
                      <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold">Social Post Package</p>
                          <span className={`prod-status-pill ${pkg.socialStatus === "Ready" ? "done" : pkg.socialStatus === "Needs review" ? "failed" : "waiting"}`}>{pkg.socialStatus}</span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900">{pkg.socialPostTitle}</p>
                        <p className="mt-1 text-sm text-slate-600">{pkg.socialCaption}</p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {pkg.selectedSocialPlatforms.length > 0 ? pkg.selectedSocialPlatforms.map((platformId) => {
                            const platform = getSocialPlatform(platformId);
                            if (!platform) return null;
                            return (
                              <span key={`${pkg.rowId}-${platform.id}`} className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1 text-xs text-slate-700">
                                <img src={platform.icon.src} alt={platform.label} className="h-4 w-4 object-contain" />
                                {platform.label}
                              </span>
                            );
                          }) : (
                            <span className="text-xs text-slate-500">No social platforms selected.</span>
                          )}
                        </div>
                      </div>
                      ) : null}
                    </div>
                    <div className="agency-publish-meta">
                      {showGoogle ? (
                        <>
                          <p className="text-xs uppercase tracking-wide text-slate-500">Template</p>
                          <p className="mb-3 text-sm font-medium">{template.name}</p>
                        </>
                      ) : null}
                      <p className="text-xs uppercase tracking-wide text-slate-500">Readiness</p>
                      <p className="mb-3 text-sm font-medium">{score}% complete</p>
                      {showGoogle ? (
                        <>
                          <p className="text-xs uppercase tracking-wide text-slate-500">CTA</p>
                          <p className="text-sm font-medium">{pkg.cta}</p>
                        </>
                      ) : null}
                      {showSocial ? (
                        <>
                          <p className={`text-xs uppercase tracking-wide text-slate-500 ${showGoogle ? "mt-3" : ""}`}>Social CTA</p>
                          <p className="text-sm font-medium">{pkg.socialCta}</p>
                        </>
                      ) : null}
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
