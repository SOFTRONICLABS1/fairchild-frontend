"use client";
import { useState } from "react";
import Shell from "@/components/layout/shell";
import SectionRunner from "@/components/common/section-runner";
import SimpleForm from "@/components/forms/simple-form";
import { mockApi } from "@/lib/api/endpoints/mock";

export default function RenderformPage() {
  const [apiKey, setApiKey] = useState("rf_key_123");
  const [imageUrl, setImageUrl] = useState("https://example.com/image.png");
  const [filename, setFilename] = useState("upload.png");
  return <Shell title="RenderForm">
    <div className="grid gap-4 md:grid-cols-2">
      <SimpleForm label="API Key" placeholder="rf_key" onSubmit={setApiKey} />
      <SimpleForm label="Render Image URL" placeholder="https://..." onSubmit={setImageUrl} />
      <div className="rounded border bg-white p-4">
        <label className="mb-2 block text-sm">Upload file</label>
        <input type="file" className="w-full text-sm" onChange={(e) => setFilename(e.target.files?.[0]?.name ?? "upload.png")} />
      </div>
      <SectionRunner title="Authorize" run={() => mockApi.renderformAuthorize(apiKey)} payload={{ apiKey }} />
      <SectionRunner title="List Templates" run={() => mockApi.renderformTemplates()} />
      <SectionRunner title="Render URL" run={() => mockApi.renderformRenderUrl(imageUrl)} payload={{ imageUrl }} />
      <SectionRunner title="Render Upload" run={() => mockApi.renderformRenderUpload(filename)} payload={{ filename }} />
    </div>
  </Shell>;
}
