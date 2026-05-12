"use client";
import { useState } from "react";
import Shell from "@/components/layout/shell";
import SimpleForm from "@/components/forms/simple-form";
import SectionRunner from "@/components/common/section-runner";
import { mockApi } from "@/lib/api/endpoints/mock";

export default function ImpactPage() {
  const [id, setId] = useState("100");
  const [dealId, setDealId] = useState("d-1");
  const [q, setQ] = useState("laptop");
  return <Shell title="Impact">
    <div className="grid gap-4 md:grid-cols-2">
      <SimpleForm label="Campaign ID" placeholder="100" onSubmit={setId} />
      <SimpleForm label="Deal ID" placeholder="d-1" onSubmit={setDealId} />
      <SimpleForm label="Item Search" placeholder="keyword" onSubmit={setQ} />
      <SectionRunner title="Authorize" run={() => mockApi.impactAuthorize({ accountSid: "demo" })} />
      <SectionRunner title="Campaigns List" run={() => mockApi.impactCampaigns()} />
      <SectionRunner title="Campaign By ID" run={() => mockApi.impactCampaignById(id)} payload={{ id }} />
      <SectionRunner title="Deals List" run={() => mockApi.impactDeals()} />
      <SectionRunner title="Deal By ID" run={() => mockApi.impactDealById(dealId)} payload={{ dealId }} />
      <SectionRunner title="Catalogs" run={() => mockApi.impactCatalogs()} />
      <SectionRunner title="Catalog Items" run={() => mockApi.impactCatalogItems()} />
      <SectionRunner title="Item Search" run={() => mockApi.impactItemSearch(q)} payload={{ q }} />
      <SectionRunner title="Media Properties" run={() => mockApi.impactMediaProperties()} />
      <SectionRunner title="Create Tracking Link" run={() => mockApi.impactTrackingLink({ campaignId: id, url: "https://example.com" })} />
    </div>
  </Shell>;
}
