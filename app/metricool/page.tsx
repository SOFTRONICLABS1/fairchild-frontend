"use client";
import { useState } from "react";
import Shell from "@/components/layout/shell";
import SectionRunner from "@/components/common/section-runner";
import SimpleForm from "@/components/forms/simple-form";
import { mockApi } from "@/lib/api/endpoints/mock";

export default function MetricoolPage() {
  const [token, setToken] = useState("metricool-token");
  return <Shell title="Metricool">
    <div className="grid gap-4 md:grid-cols-2">
      <SimpleForm label="Token" placeholder="metricool token" onSubmit={setToken} />
      <SectionRunner title="Authorize" run={() => mockApi.metricoolAuthorize(token)} payload={{ token }} />
      <SectionRunner title="Get Profiles" run={() => mockApi.metricoolProfiles()} />
      <SectionRunner title="Upload Media" run={() => mockApi.metricoolUploadMedia({ userId: "u1", blogId: "b1", filename: "asset.png" })} />
      <SectionRunner title="Create Scheduler Post" run={() => mockApi.metricoolCreatePost({ userId: "u1", blogId: "b1", text: "Hello" })} />
      <SectionRunner title="Get Scheduler Posts" run={() => mockApi.metricoolGetPosts()} />
    </div>
  </Shell>;
}
