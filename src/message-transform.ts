import type { HistoryEntry } from "./history.js";
import { type Translator, translatePrompt } from "./pipeline.js";
import { needsTranslation } from "./translation.js";

export interface MessageTransformResult {
  body: unknown;
  translated: boolean;
  failure?: string;
  history?: HistoryEntry;
}

interface ContentBlock {
  type?: unknown;
  text?: unknown;
  [key: string]: unknown;
}

interface Message {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

const RAW_INPUT = /^\s*[!/]/;
const INTERNAL_SESSION_TITLE =
  /^<session>[\s\S]*<\/session>\s*Write the title in [^.]+\. Keep technical terms and code identifiers in their original form\.\s*$/i;
const SYSTEM_REMINDER = /^<system-reminder>[\s\S]*<\/system-reminder>\s*$/i;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function isInternalAgentPayload(text: string): boolean {
  const trimmed = text.trim();
  if (SYSTEM_REMINDER.test(trimmed) || INTERNAL_SESSION_TITLE.test(trimmed)) return true;
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    // A Claude internal payload can contain one compact JSON object per line.
  }
  const lines = trimmed.split("\n").filter((item) => item.trim().length > 0);
  if (lines.length < 2) return false;
  for (const line of lines) {
    try {
      JSON.parse(line);
    } catch {
      return false;
    }
  }
  return true;
}

function separator(index: number): string {
  return [`\n\n\`KLAUXY_TEXT_BLOCK_`, index, "`\n\n"].join("");
}

export async function transformMessagesBody(
  body: unknown,
  enabled: boolean,
  translator: Translator,
  signal?: AbortSignal,
): Promise<MessageTransformResult> {
  const passThrough = (failure?: string): MessageTransformResult => ({
    body,
    translated: false,
    ...(failure === undefined ? {} : { failure }),
  });
  if (!enabled) return passThrough();

  const record = asRecord(body);
  if (!record || !Array.isArray(record.messages)) return passThrough();
  const messages = record.messages as unknown[];
  let messageIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (asRecord(messages[index])?.role === "user") {
      messageIndex = index;
      break;
    }
  }
  if (messageIndex < 0) return passThrough();

  const message = asRecord(messages[messageIndex]) as Message | undefined;
  if (!message || !Array.isArray(message.content)) return passThrough();
  const blocks = message.content as unknown[];
  if (blocks.some((block) => asRecord(block)?.type === "tool_result")) return passThrough();

  const textIndexes: number[] = [];
  const texts: string[] = [];
  for (const [index, value] of blocks.entries()) {
    const block = asRecord(value) as ContentBlock | undefined;
    if (
      block?.type === "text" &&
      typeof block.text === "string" &&
      // Cheap Korean scan first: most blocks are English and never reach the
      // JSON parsing inside isInternalAgentPayload.
      needsTranslation(block.text) &&
      !isInternalAgentPayload(block.text)
    ) {
      textIndexes.push(index);
      texts.push(block.text);
    }
  }
  if (
    texts.length === 0 ||
    RAW_INPUT.test(texts[0]) ||
    (texts.length === 1 && INTERNAL_SESSION_TITLE.test(texts[0]))
  )
    return passThrough();

  const combined = texts
    .map((text, index) => (index === 0 ? text : separator(index - 1) + text))
    .join("");
  const result = await translatePrompt(combined, true, translator, signal);
  if (!result.translated) {
    return {
      ...passThrough(result.failure),
      history: {
        schema: 1,
        timestamp: new Date().toISOString(),
        status: "failed",
        durationMs: result.durationMs,
        original: texts.join("\n\n"),
        sent: texts.join("\n\n"),
        ...(result.failure === undefined ? {} : { failure: result.failure }),
      },
    };
  }

  const translatedTexts: string[] = [];
  let remaining = result.text;
  for (let index = 0; index < texts.length - 1; index++) {
    const marker = separator(index);
    const parts = remaining.split(marker);
    if (parts.length !== 2) return passThrough("invalid translated text block boundaries");
    translatedTexts.push(parts[0].trim());
    remaining = parts[1];
  }
  translatedTexts.push(remaining.trim());
  if (translatedTexts.some((text) => text.length === 0)) {
    return passThrough("empty translated text block");
  }

  const nextBlocks = [...blocks];
  for (const [position, blockIndex] of textIndexes.entries()) {
    nextBlocks[blockIndex] = {
      ...(blocks[blockIndex] as ContentBlock),
      text: translatedTexts[position],
    };
  }
  const nextMessages = [...messages];
  nextMessages[messageIndex] = { ...message, content: nextBlocks };
  return {
    body: { ...record, messages: nextMessages },
    translated: true,
    history: {
      schema: 1,
      timestamp: new Date().toISOString(),
      status: "translated",
      durationMs: result.durationMs,
      original: texts.join("\n\n"),
      sent: translatedTexts.join("\n\n"),
    },
  };
}
