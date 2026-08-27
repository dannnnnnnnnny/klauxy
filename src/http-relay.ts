import type { IncomingHttpHeaders, ServerResponse } from "node:http";
import type { Readable } from "node:stream";

/**
 * Header and body plumbing for forwarding one HTTP request to an upstream.
 *
 * Kept apart from the proxy's request logic so the rules about which headers
 * survive a hop are stated once and can be read without the surrounding
 * translation flow.
 */

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

/**
 * Copies client headers for the upstream fetch.
 *
 * Anthropic credentials pass through untouched; only hop-by-hop headers and the
 * ones fetch must own (host, content-length) are dropped.
 */
export function requestHeaders(
  input: IncomingHttpHeaders,
  contentLength: number | undefined,
): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(input)) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "host" || lower === "content-length") continue;
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) output.append(name, item);
    } else {
      output.set(name, value);
    }
  }
  if (contentLength !== undefined && contentLength > 0) {
    output.set("content-length", String(contentLength));
  }
  return output;
}

/**
 * Copies upstream headers back to the client.
 *
 * content-length and content-encoding are omitted because fetch has already
 * decompressed the body, so advertising the original encoding would corrupt it.
 */
export function responseHeaders(response: Response): Record<string, string | string[]> {
  const output: Record<string, string | string[]> = {};
  for (const [name, value] of response.headers) {
    const lower = name.toLowerCase();
    if (HOP_BY_HOP.has(lower) || lower === "content-length" || lower === "content-encoding") {
      continue;
    }
    output[name] = value;
  }
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) output["set-cookie"] = cookies;
  return output;
}

export class BodyTooLargeError extends Error {
  constructor() {
    super("request body exceeds Klauxy proxy limit");
    this.name = "BodyTooLargeError";
  }
}

/**
 * Buffers a request body up to `maximum` bytes.
 *
 * Keeps draining after the limit trips: abandoning an unread request stream
 * leaves the client waiting instead of seeing the error response.
 */
export async function readBody(request: Readable, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  let exceeded = false;
  for await (const value of request) {
    if (exceeded) continue;
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > maximum) {
      exceeded = true;
      chunks.length = 0;
      continue;
    }
    chunks.push(chunk);
  }
  if (exceeded) throw new BodyTooLargeError();
  return Buffer.concat(chunks);
}

/** Reports a proxy-side failure without leaking internals to the client. */
export function sendInternalError(response: ServerResponse, error: unknown): void {
  if (response.headersSent) {
    response.destroy();
    return;
  }
  const status = error instanceof BodyTooLargeError ? 413 : 502;
  response.writeHead(status, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      type: "error",
      error: { type: "api_error", message: "Klauxy proxy request failed" },
    }),
  );
}
