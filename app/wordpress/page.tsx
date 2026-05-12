"use client";
import { useState } from "react";
import Shell from "@/components/layout/shell";
import SectionRunner from "@/components/common/section-runner";
import { mockApi } from "@/lib/api/endpoints/mock";

export default function WordpressPage() {
  const [filename, setFilename] = useState("demo.jpg");
  return <Shell title="WordPress">
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded border bg-white p-4">
        <label className="mb-2 block text-sm">Media file</label>
        <input type="file" className="mb-2 w-full text-sm" onChange={(e) => setFilename(e.target.files?.[0]?.name ?? "demo.jpg")} />
      </div>
      <SectionRunner title="Authorize" run={() => mockApi.wpAuthorize({ domain: "demo.com", wcKey: "ck_123", wcSecret: "cs_123" })} />
      <SectionRunner title="Media Upload" run={() => mockApi.wpUploadMedia(filename)} payload={{ filename }} />
      <SectionRunner title="Create Product" run={() => mockApi.wpCreateProduct({ name: "Demo Product", price: "19.99" })} />
    </div>
  </Shell>;
}
