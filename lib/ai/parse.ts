/**
 * Robust parsing of JSON returned by the Claude generate endpoint.
 *
 * The model occasionally wraps its JSON in prose, markdown fences, or emits a second
 * object after the first. The previous approach — slicing from the first `{` to the last
 * `}` and calling JSON.parse once — throws "Unexpected non-whitespace character after JSON"
 * the moment anything follows the object. This module instead extracts the FIRST balanced
 * object via a brace-depth scan that respects string literals, so trailing content is
 * ignored rather than fatal.
 */

export class AiParseError extends Error {
  readonly raw: string;
  constructor(message: string, raw: string) {
    super(message);
    this.name = "AiParseError";
    this.raw = raw;
  }
}

/** Removes ```json … ``` / ``` … ``` fences the model sometimes adds around JSON. */
function stripCodeFences(value: string): string {
  const trimmed = value.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fence ? fence[1].trim() : trimmed;
}

/**
 * Returns the first balanced `{…}` (or `[…]`) object in `value`, scanning brace depth while
 * skipping over string contents and escapes so a `}` inside a string never ends the object.
 * Returns null when no complete, balanced object is present (e.g. truncated output).
 */
export function extractFirstJsonObject(value: string): string | null {
  const text = stripCodeFences(value);
  const open = text.search(/[{[]/);
  if (open < 0) return null;

  const openChar = text[open];
  const closeChar = openChar === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth += 1;
    } else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(open, i + 1);
      }
    }
  }

  // Ran out of characters with an unclosed object — truncated / malformed.
  return null;
}

/**
 * Extracts and parses the first balanced JSON object from raw model text.
 * Throws AiParseError (carrying the raw text) on any failure so callers can retry or fall
 * back, and can distinguish a parse failure from a network/HTTP failure.
 */
export function parseAiJson<T>(raw: string): T {
  const candidate = extractFirstJsonObject(raw);
  if (!candidate) {
    throw new AiParseError("AI response did not contain a complete JSON object", raw);
  }
  try {
    return JSON.parse(candidate) as T;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AiParseError(`AI response was not valid JSON: ${detail}`, raw);
  }
}

/**
 * Normalizes the various envelope shapes the generate endpoint can return into the raw
 * text string. The backend returns `{ text }`, but older/edge responses may nest the
 * content under `output` / `content` / `response`, or return a bare string.
 */
export function rawTextFromGenerateData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data && typeof data === "object") {
    const record = data as Record<string, unknown>;
    const candidate = record.text ?? record.output ?? record.content ?? record.response;
    if (typeof candidate === "string") return candidate;
    return JSON.stringify(candidate ?? data);
  }
  return "";
}
