"use client";
import { useState } from "react";
import Shell from "@/components/layout/shell";
import SimpleForm from "@/components/forms/simple-form";
import SectionRunner from "@/components/common/section-runner";
import { mockApi } from "@/lib/api/endpoints/mock";

export default function CjPage() {
  const [token, setToken] = useState("demo-cj-token");
  const [query, setQuery] = useState("wireless");
  return <Shell title="CJ">
    <div className="grid gap-4 md:grid-cols-2">
      <SimpleForm label="Authorize Token" placeholder="cj token" onSubmit={setToken} />
      <SimpleForm label="Ads Product Query" placeholder="keyword" onSubmit={setQuery} />
      <SectionRunner title="Authorize" run={() => mockApi.cjAuthorize({ token })} payload={{ token }} />
      <SectionRunner title="Advertiser Lookup" run={() => mockApi.cjAdvertisers()} />
      <SectionRunner title="Ads Product Query" run={() => mockApi.cjProducts({ query })} payload={{ query }} />
    </div>
  </Shell>;
}
