"use client";

import Link from "next/link";
import TopNav from "@/components/flow/top-nav";

export default function SearchPage() {
  return (
    <>
      <TopNav />
      <div className="page-wrap flex items-center">
        <div className="mx-auto max-w-[880px] -translate-y-12">
          <div className="agency-hero agency-chooser-hero agency-header-card mb-8">
            <div>
              <p className="agency-kicker">Choose Your Workflow</p>
              <h1 className="agency-title">Choose how you want to create content</h1>
              <p className="agency-copy">Start with affiliate publishing or brand campaign packaging.</p>
            </div>
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Link href="/agency/upload" className="agency-entry-card">
              <div className="agency-entry-top">
                <span className="agency-entry-badge agency-entry-badge-brand">AB</span>
                <div className="agency-steps">
                  <span>Upload</span>
                  <span className="agency-steps-sep">/</span>
                  <span>Package</span>
                  <span className="agency-steps-sep">/</span>
                  <span>Publish</span>
                </div>
              </div>
              <div className="agency-entry-body">
                <p className="agency-entry-label">Agency/Brand Workflow</p>
                <h2 className="agency-entry-title">Build location-based ad packages</h2>
                <p className="agency-entry-copy">Upload one image per location, add landing pages, and review creative packages before publish.</p>
                <div className="agency-entry-spacer" />
                <div className="agency-entry-cta agency-entry-cta-brand">
                  <span>Get started</span>
                  <span className="agency-entry-arrow">→</span>
                </div>
              </div>
            </Link>

            <Link href="/affiliate/search" className="agency-entry-card agency-entry-card-muted">
              <div className="agency-entry-top">
                <span className="agency-entry-badge agency-entry-badge-affiliate">AF</span>
                <div className="agency-steps">
                  <span>Search</span>
                  <span className="agency-steps-sep">/</span>
                  <span>Review</span>
                  <span className="agency-steps-sep">/</span>
                  <span>Publish</span>
                </div>
              </div>
              <div className="agency-entry-body">
                <p className="agency-entry-label">Affiliate Workflow</p>
                <h2 className="agency-entry-title">Search and publish affiliate products</h2>
                <p className="agency-entry-copy">Use CJ and Impact search, curate products, and run the publishing pipeline.</p>
                <div className="agency-entry-spacer" />
                <div className="agency-entry-cta agency-entry-cta-affiliate">
                  <span>Get started</span>
                  <span className="agency-entry-arrow">→</span>
                </div>
              </div>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
