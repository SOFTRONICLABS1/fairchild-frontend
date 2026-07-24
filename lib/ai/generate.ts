import { http, unwrapEnvelope } from "@/lib/api/client";
import { AiParseError, parseAiJson, rawTextFromGenerateData } from "@/lib/ai/parse";

/**
 * Model candidates for the generate endpoint.
 *
 * IMPORTANT: `responseJson` uses backend assistant-prefill, which 400s on current-gen models
 * (Opus 4.6+/Sonnet 4.6+/Fable 5). Keep this list to prefill-capable models. The robust
 * parser is the safety net regardless.
 */
export const AI_MODELS = ["claude-sonnet-4-5"];

export type GenerateJsonOptions = {
  prompt: string;
  system?: string;
  maxTokens?: number;
  temperature?: number;
  modelCandidates?: string[];
  /** Retries once on a parse failure (not on network errors, which surface immediately). */
  retryOnParseError?: boolean;
};

/**
 * Calls POST /api/v1/claude/generate in JSON mode and returns the parsed object.
 *
 * Robustness layers: backend `responseJson` forces the output to start as JSON, the
 * brace-depth parser tolerates any trailing prose, and a single retry covers the rare case
 * the model still returns something unparseable. Throws AiParseError only after the retry.
 */
export async function generateJson<T>({
  prompt,
  system,
  maxTokens = 1024,
  temperature = 0.2,
  modelCandidates = AI_MODELS,
  retryOnParseError = true
}: GenerateJsonOptions): Promise<T> {
  const attempt = async (): Promise<T> => {
    const response = await http.post("/api/v1/claude/generate", {
      prompt,
      system,
      responseJson: true,
      modelCandidates,
      maxTokens,
      temperature
    });
    const data = unwrapEnvelope<unknown>(response.data);
    return parseAiJson<T>(rawTextFromGenerateData(data));
  };

  try {
    return await attempt();
  } catch (error) {
    // Retry only parse failures; a network/HTTP error should surface right away.
    if (retryOnParseError && error instanceof AiParseError) {
      return await attempt();
    }
    throw error;
  }
}
