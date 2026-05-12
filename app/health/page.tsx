"use client";
import { useQuery } from "@tanstack/react-query";
import Shell from "@/components/layout/shell";
import { mockApi } from "@/lib/api/endpoints/mock";
import ResponseViewer from "@/components/common/response-viewer";

export default function HealthPage() {
  const query = useQuery({ queryKey: ["health"], queryFn: mockApi.health });
  return <Shell title="Health Check">
    {query.isLoading && <p>Loading health...</p>}
    {query.error && <p className="text-red-600">{(query.error as Error).message}</p>}
    {query.data && <ResponseViewer data={query.data} />}
  </Shell>;
}
