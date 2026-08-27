import { createServer } from "node:http";
import { Readable } from "node:stream";
import type { HistoryEntry } from "./history.js";
import { readBody, requestHeaders, responseHeaders, sendInternalError } from "./http-relay.js";
import { transformMessagesBody } from "./message-transform.js";
import type { Translator } from "./pipeline.js";

export interface AnthropicProxyOptions {
  upstream: URL;
  translator: Translator;
  readEnabled(): Promise<boolean>;
  writeHistory?(entry: HistoryEntry): Promise<void>;
  maxBodyBytes?: number;
  listen?: { host: string; port: number };
}

export interface AnthropicProxy {
  baseUrl: string;
  close(): Promise<void>;
}

const MESSAGES_PATH = "/v1/messages";

/**
 * Recognises the one endpoint Klauxy rewrites.
 *
 * Compares the path prefix directly instead of constructing a URL: this runs on
 * every proxied request, and allocating a URL only to read `pathname` showed up
 * as avoidable work on the hot path.
 */
function isMessagesRequest(method: string | undefined, url: string | undefined): boolean {
  if (method !== "POST" || url === undefined) return false;
  if (!url.startsWith(MESSAGES_PATH)) return false;
  const next = url.charCodeAt(MESSAGES_PATH.length);
  // End of string, query, or fragment: anything else is a longer path segment.
  return Number.isNaN(next) || next === 63 || next === 35;
}

export async function startAnthropicProxy(options: AnthropicProxyOptions): Promise<AnthropicProxy> {
  const upstream = new URL(options.upstream);
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error("Anthropic upstream must use HTTP or HTTPS");
  }
  const active = new Set<AbortController>();
  const pendingHistory = new Set<Promise<void>>();
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/__klauxy/health") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end('{"ok":true}');
      return;
    }
    const controller = new AbortController();
    active.add(controller);
    const cancel = () => controller.abort();
    request.once("aborted", cancel);
    response.once("close", () => {
      if (!response.writableEnded) cancel();
    });
    try {
      const method = request.method ?? "GET";
      const rewritable = isMessagesRequest(method, request.url);
      let history: HistoryEntry | undefined;
      let body: Buffer | Readable | undefined;
      let contentLength: number | undefined;

      if (rewritable) {
        // Only the rewritten endpoint needs the whole body in memory.
        const originalBody = await readBody(request, options.maxBodyBytes ?? 10 * 1024 * 1024);
        body = originalBody;
        contentLength = originalBody.length;
        if (originalBody.length > 0) {
          try {
            const transformed = await transformMessagesBody(
              JSON.parse(originalBody.toString("utf8")),
              await options.readEnabled(),
              options.translator,
              controller.signal,
            );
            if (transformed.translated) {
              const rewritten = Buffer.from(JSON.stringify(transformed.body));
              body = rewritten;
              contentLength = rewritten.length;
            }
            history = transformed.history;
          } catch {
            // Unparseable or untranslatable bodies are forwarded untouched.
          }
        }
      } else if (method !== "GET" && method !== "HEAD") {
        // Everything else streams straight through, so large uploads such as
        // file attachments never accumulate in the proxy.
        body = request;
        const declared = Number(request.headers["content-length"]);
        contentLength = Number.isFinite(declared) ? declared : undefined;
      }

      const target = new URL(request.url ?? "/", upstream);
      const upstreamResponse = await fetch(target, {
        method,
        headers: requestHeaders(request.headers, contentLength),
        body: body as never,
        ...(body === request ? { duplex: "half" } : {}),
        redirect: "manual",
        signal: controller.signal,
      });
      response.writeHead(
        upstreamResponse.status,
        upstreamResponse.statusText,
        responseHeaders(upstreamResponse),
      );
      if (history && options.writeHistory) {
        const write = options.writeHistory(history).catch(() => {
          // History is diagnostic only and must never block an Anthropic response.
        });
        pendingHistory.add(write);
        void write.finally(() => pendingHistory.delete(write));
      }
      if (!upstreamResponse.body || method === "HEAD") {
        response.end();
      } else {
        await new Promise<void>((resolve, reject) => {
          const stream = Readable.fromWeb(upstreamResponse.body as never);
          stream.once("error", reject);
          response.once("error", reject);
          response.once("finish", resolve);
          stream.pipe(response);
        });
      }
    } catch (error) {
      if (!controller.signal.aborted) sendInternalError(response, error);
    } finally {
      active.delete(controller);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.listen?.port ?? 0, options.listen?.host ?? "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Klauxy proxy has no TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  if (new URL(baseUrl).origin === upstream.origin) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("Anthropic upstream cannot be the Klauxy proxy itself");
  }

  let closing: Promise<void> | undefined;
  return {
    baseUrl,
    close() {
      closing ??= Promise.all([
        new Promise<void>((resolve, reject) => {
          for (const controller of active) controller.abort();
          server.close((error) => (error ? reject(error) : resolve()));
          server.closeAllConnections();
        }),
        Promise.all([...pendingHistory]),
      ]).then(() => undefined);
      return closing;
    },
  };
}
