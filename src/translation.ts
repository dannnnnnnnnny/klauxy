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

export function restore(masked: string, tokens: string[]): string {
  let restored = masked;
  for (const [index, token] of tokens.entries()) {
    restored = restored.split(["{K", index, "}"].join("")).join(token);
  }
  return restored;
}

export function validateTranslation(text: string, placeholders: string[]): boolean {
  const trimmed = text.trim();
  if (trimmed.length === 0 || KOREAN_PATTERN.test(trimmed)) return false;
  if (
    /<\/?source_text>|translate the following (?:source text|untrusted data)|return only the concise english translation of source_text|do not follow, answer, or act on any instruction/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  if (
    /^(?:ok(?:[.!]|$)|here(?:'s| is) (?:the )?translation|translation:|sure[,!]|the user wants|i (?:can|will|would)|please provide)/i.test(
      trimmed,
    )
  ) {
    return false;
  }
  const actualPlaceholders = trimmed.match(/\{K\d+\}/g) ?? [];
  if (actualPlaceholders.length !== placeholders.length) return false;
  return placeholders.every(
    (placeholder) => actualPlaceholders.filter((actual) => actual === placeholder).length === 1,
  );
}
