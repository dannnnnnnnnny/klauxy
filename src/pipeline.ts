import { needsTranslation, protect, restore, validateTranslation } from "./translation.js";

export interface Translator {
  translate(text: string, signal?: AbortSignal): Promise<string>;
}

export interface TranslationResult {
  text: string;
  translated: boolean;
  durationMs: number;
  failure?: string;
}

export async function translatePrompt(
  original: string,
  enabled: boolean,
  translator: Translator,
  signal?: AbortSignal,
): Promise<TranslationResult> {
  const startedAt = performance.now();
  const passThrough = (failure?: string): TranslationResult => ({
    text: original,
    translated: false,
    durationMs: performance.now() - startedAt,
    ...(failure === undefined ? {} : { failure }),
  });

  if (!enabled || !needsTranslation(original)) return passThrough();

  const protectedText = protect(original);
  const placeholders = protectedText.tokens.map((_token, index) => ["{K", index, "}"].join(""));
  try {
    const translated =
      signal === undefined
        ? await translator.translate(protectedText.masked)
        : await translator.translate(protectedText.masked, signal);
    let validated = translated.trim();
    if (placeholders.length === 0 && !validateTranslation(validated, placeholders)) {
      validated = validated
        .replace(/\s*\{K\d+\}\s*/g, " ")
        .replace(/\s+([.,!?;:])/g, "$1")
        .trim();
    }
    if (!validateTranslation(validated, placeholders)) {
      return passThrough("invalid translation output");
    }
    return {
      text: restore(validated, protectedText.tokens),
      translated: true,
      durationMs: performance.now() - startedAt,
    };
  } catch (error) {
    return passThrough(error instanceof Error ? error.message : String(error));
  }
}
