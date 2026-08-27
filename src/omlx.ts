import { ChatTranslator } from "./chat-translator.js";
import { PROVIDERS } from "./providers.js";

export interface OmlxOptions {
  host: string;
  model: string;
  timeout_ms: number;
  max_tokens: number;
  system_prompt: string;
}

/**
 * Backwards-compatible oMLX translator. Retained so existing callers and tests
 * keep working now that provider selection lives in providers.ts.
 */
export class OmlxTranslator extends ChatTranslator {
  constructor(options: OmlxOptions) {
    super({
      ...options,
      chat_path: PROVIDERS.omlx.chatPath,
      label: "oMLX",
      ...(PROVIDERS.omlx.extraBody === undefined ? {} : { extra_body: PROVIDERS.omlx.extraBody }),
    });
  }
}
