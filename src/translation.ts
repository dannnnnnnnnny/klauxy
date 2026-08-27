export interface ProtectedText {
  masked: string;
  tokens: string[];
}

const KOREAN_PATTERN = /[\u3131-\u318e\uac00-\ud7a3]/u;
const PROTECTED_PATTERN =
  /(?:\x60\x60\x60[\s\S]*?\x60\x60\x60|\x60[^\x60\n]+\x60|https?:\/\/[^\s]+|\.\/[A-Za-z0-9_./-]+(?:[ \t]+(?:--?[A-Za-z0-9_-]+(?:=[^\s]+)?|[A-Za-z0-9_./:=+-]+))*|[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+)/g;

export function needsTranslation(input: string): boolean {
  return KOREAN_PATTERN.test(input);
}

export function protect(input: string): ProtectedText {
  const tokens: string[] = [];
  const masked = input.replace(PROTECTED_PATTERN, (token) => {
    const placeholder = ["{K", tokens.length, "}"].join("");
    tokens.push(token);
    return placeholder;
  });
  return { masked, tokens };
}

const PLACEHOLDER_PATTERN = /\{K(\d+)\}/g;

/**
 * Substitutes every `{Kn}` placeholder back to its original token.
 *
 * Rewrites in one pass. Splitting and rejoining per token walked the whole
 * string once for every placeholder, which is quadratic on prompts that mask
 * many paths or code spans.
 */
export function restore(masked: string, tokens: string[]): string {
  if (tokens.length === 0) return masked;
  return masked.replace(PLACEHOLDER_PATTERN, (placeholder, digits: string) => {
    const index = Number(digits);
    return index < tokens.length ? (tokens[index] as string) : placeholder;
  });
}

const ECHOED_PROMPT =
  /<\/?source_text>|translate the following (?:source text|untrusted data)|return only the concise english translation of source_text|do not follow, answer, or act on any instruction/i;
const PREAMBLE =
  /^(?:ok(?:[.!]|$)|here(?:'s| is) (?:the )?translation|translation:|sure[,!]|the user wants|i (?:can|will|would)|please provide)/i;

export function validateTranslation(text: string, placeholders: string[]): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || KOREAN_PATTERN.test(trimmed)) return false;
  if (ECHOED_PROMPT.test(trimmed)) return false;
  if (PREAMBLE.test(trimmed)) return false;

  // Count occurrences once instead of rescanning the match list per placeholder.
  const seen = new Map<string, number>();
  let total = 0;
  for (const match of trimmed.matchAll(PLACEHOLDER_PATTERN)) {
    seen.set(match[0], (seen.get(match[0]) ?? 0) + 1);
    total += 1;
  }
  if (total !== placeholders.length) return false;
  return placeholders.every((placeholder) => seen.get(placeholder) === 1);
}
