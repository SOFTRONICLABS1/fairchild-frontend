import { Suspense } from "react";
import ResultsClientPage from "@/app/results/results-client";

export default function ResultsPage() {
  return (
    <Suspense fallback={<div className="page-wrap">Loading results...</div>}>
      <ResultsClientPage />
    </Suspense>
  );
}
