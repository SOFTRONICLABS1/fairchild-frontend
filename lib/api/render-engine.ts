import { http, unwrapEnvelope } from "@/lib/api/client";
import type { ApiEnvelope } from "@/lib/types/api";

// The backend's USE_RENDERFORM flag decides the image engine:
//   true  -> /api/v1/renderform/*   (RenderForm API)
//   false -> /api/v1/renderpython/* (free local Python renderer, same templates)
let cached: Promise<string> | null = null;

export function getRenderBase(): Promise<string> {
  if (!cached) {
    cached = http
      .get<ApiEnvelope<{ engine: string; basePath: string }>>("/api/v1/health/render-engine")
      .then((res) => `/api/v1${unwrapEnvelope(res.data).basePath}`)
      .catch(() => {
        cached = null;
        return "/api/v1/renderform";
      });
  }
  return cached;
}
