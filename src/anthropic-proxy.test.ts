import { createServer, type IncomingMessage, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startAnthropicProxy } from "./anthropic-proxy.js";

const servers: Array<{ close(): Promise<void> }> = [];

async function listen(
  handler: (
    request: IncomingMessage,
    body: Buffer,
  ) =>
    | { status?: number; headers?: Record<string, string>; body?: string }
    | Promise<{ status?: number; headers?: Record<string, string>; body?: string }>,
): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", async () => {
      const result = await handler(request, Buffer.concat(chunks));
      response.writeHead(
        result.status ?? 200,
        result.headers ?? { "content-type": "application/json" },
      );
      response.end(result.body ?? "{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("unexpected address");
  const handle = {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      ),
  };
  servers.push(handle);
  return handle;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("Anthropic loopback proxy", () => {
  it("can bind a stable port and exposes a local health check", async () => {
    const proxy = await startAnthropicProxy({
      upstream: new URL("https://api.anthropic.com"),
      translator: { translate: vi.fn() },
      readEnabled: async () => false,
      listen: { host: "127.0.0.1", port: 0 },
    });
    servers.push(proxy);

    const response = await fetch(`${proxy.baseUrl}/__kagent/health`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("translates an eligible Messages body and preserves path, query, and Anthropic headers", async () => {
    let received: { url?: string; authorization?: string; beta?: string; body?: unknown } = {};
    const upstream = await listen((request, body) => {
      received = {
        url: request.url,
        authorization: request.headers.authorization,
        beta: request.headers["anthropic-beta"] as string | undefined,
        body: JSON.parse(body.toString("utf8")),
      };
      return {
        headers: { "content-type": "text/event-stream" },
        body: 'event: message_stop\ndata: {"type":"message_stop"}\n\n',
      };
    });
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn().mockResolvedValue("Fix this code.") },
      readEnabled: async () => true,
    });
    servers.push(proxy);

    const response = await fetch(`${proxy.baseUrl}/v1/messages?beta=true`, {
      method: "POST",
      headers: {
        authorization: "Bearer test-only-token",
        "anthropic-beta": "test-beta",
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "test",
        stream: true,
        messages: [
          { role: "user", content: [{ type: "text", text: "이 코드를 고쳐줘" }] },
          { role: "system", content: "internal" },
        ],
      }),
    });

    expect(response.status).toBe(200);
    expect(received).toMatchObject({
      url: "/v1/messages?beta=true",
      authorization: "Bearer test-only-token",
      beta: "test-beta",
    });
    expect(received.body).toMatchObject({
      messages: [
        { role: "user", content: [{ type: "text", text: "Fix this code." }] },
        { role: "system", content: "internal" },
      ],
    });
  });

  it("records the original and actual translated text after upstream accepts the request", async () => {
    const upstream = await listen(() => ({ body: "ok" }));
    const writeHistory = vi.fn().mockResolvedValue(undefined);
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn().mockResolvedValue("Explain this project.") },
      readEnabled: async () => true,
      writeHistory,
    });
    servers.push(proxy);

    await fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: "이 프로젝트를 설명해줘" }] }],
      }),
    });

    expect(writeHistory).toHaveBeenCalledOnce();
    expect(writeHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        schema: 1,
        status: "translated",
        original: "이 프로젝트를 설명해줘",
        sent: "Explain this project.",
      }),
    );
  });

  it("forwards the original bytes exactly once when translation fails", async () => {
    const bodies: Buffer[] = [];
    const upstream = await listen((_request, body) => {
      bodies.push(body);
      return { body: "ok" };
    });
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn().mockRejectedValue(new Error("oMLX unavailable")) },
      readEnabled: async () => true,
    });
    servers.push(proxy);
    const original = Buffer.from(
      '{"messages":[{"role":"user","content":[{"type":"text","text":"고쳐줘"}]}],"stream":true}',
    );

    await fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: original,
    });

    expect(bodies).toHaveLength(1);
    expect(bodies[0].equals(original)).toBe(true);
  });

  it("records failed translation after the original request reaches upstream", async () => {
    const upstream = await listen(() => ({ body: "ok" }));
    const writeHistory = vi.fn().mockResolvedValue(undefined);
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn().mockRejectedValue(new Error("oMLX unavailable")) },
      readEnabled: async () => true,
      writeHistory,
    });
    servers.push(proxy);

    await fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: "고쳐줘" }] }],
      }),
    });

    expect(writeHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        original: "고쳐줘",
        sent: "고쳐줘",
        failure: "oMLX unavailable",
      }),
    );
  });

  it("does not record when upstream cannot receive the request", async () => {
    const writeHistory = vi.fn().mockResolvedValue(undefined);
    const unavailable = await listen(() => ({ body: "unused" }));
    await unavailable.close();
    servers.splice(servers.indexOf(unavailable), 1);
    const proxy = await startAnthropicProxy({
      upstream: new URL(unavailable.url),
      translator: { translate: vi.fn().mockResolvedValue("Fix it.") },
      readEnabled: async () => true,
      writeHistory,
    });
    servers.push(proxy);

    await fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: "고쳐줘" }] }],
      }),
    });

    expect(writeHistory).not.toHaveBeenCalled();
  });

  it("passes token-counting requests through without translating or reserializing", async () => {
    let receivedUrl = "";
    let receivedBody = Buffer.alloc(0);
    const upstream = await listen((request, body) => {
      receivedUrl = request.url ?? "";
      receivedBody = body;
      return { body: '{"input_tokens":7}' };
    });
    const translator = { translate: vi.fn() };
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator,
      readEnabled: async () => true,
    });
    servers.push(proxy);
    const original = Buffer.from(
      '{"messages":[{"role":"user","content":[{"type":"text","text":"고쳐줘"}]}]}',
    );

    const response = await fetch(`${proxy.baseUrl}/v1/messages/count_tokens?beta=true`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: original,
    });

    expect(receivedUrl).toBe("/v1/messages/count_tokens?beta=true");
    expect(receivedBody.equals(original)).toBe(true);
    expect(translator.translate).not.toHaveBeenCalled();
    expect(await response.json()).toEqual({ input_tokens: 7 });
  });

  it("streams the first upstream SSE chunk before the response ends", async () => {
    let finish: (() => void) | undefined;
    const upstreamServer: Server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write("event: ping\ndata: first\n\n");
      finish = () => response.end("event: done\ndata: second\n\n");
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const address = upstreamServer.address();
    if (!address || typeof address === "string") throw new Error("unexpected address");
    const upstream = {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve) => upstreamServer.close(() => resolve())),
    };
    servers.push(upstream);
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn() },
      readEnabled: async () => false,
    });
    servers.push(proxy);

    const response = await fetch(`${proxy.baseUrl}/v1/messages`, { method: "POST", body: "{}" });
    const reader = response.body?.getReader();
    const first = await reader?.read();

    expect(new TextDecoder().decode(first?.value)).toContain("data: first");
    expect(first?.done).toBe(false);
    finish?.();
    await reader?.cancel();
  });

  it("preserves upstream error status and body", async () => {
    const upstream = await listen(() => ({
      status: 429,
      headers: { "content-type": "application/json", "retry-after": "3" },
      body: '{"error":"rate_limited"}',
    }));
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn() },
      readEnabled: async () => false,
    });
    servers.push(proxy);

    const response = await fetch(`${proxy.baseUrl}/v1/messages`, { method: "POST", body: "{}" });

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("3");
    expect(await response.text()).toBe('{"error":"rate_limited"}');
  });

  it("does not advertise compression after Fetch decompresses the upstream body", async () => {
    const payload = "event: message_stop\ndata: compressed\n\n";
    const compressed = gzipSync(payload);
    const upstreamServer = createServer((_request, response) => {
      response.writeHead(200, {
        "content-type": "text/event-stream",
        "content-encoding": "gzip",
        "content-length": String(compressed.length),
      });
      response.end(compressed);
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const address = upstreamServer.address();
    if (!address || typeof address === "string") throw new Error("unexpected address");
    const upstream = {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve) => upstreamServer.close(() => resolve())),
    };
    servers.push(upstream);
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn() },
      readEnabled: async () => false,
    });
    servers.push(proxy);

    const response = await fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      body: "{}",
    });

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(await response.text()).toBe(payload);
  });

  it("aborts the upstream request when the client disconnects", async () => {
    let upstreamAborted: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      upstreamAborted = resolve;
    });
    const upstreamServer = createServer((request) => {
      request.once("aborted", upstreamAborted);
      request.once("close", () => {
        if (!request.complete) upstreamAborted();
      });
    });
    await new Promise<void>((resolve) => upstreamServer.listen(0, "127.0.0.1", resolve));
    const address = upstreamServer.address();
    if (!address || typeof address === "string") throw new Error("unexpected address");
    const upstream = {
      url: `http://127.0.0.1:${address.port}`,
      close: () => new Promise<void>((resolve) => upstreamServer.close(() => resolve())),
    };
    servers.push(upstream);
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: { translate: vi.fn() },
      readEnabled: async () => false,
    });
    servers.push(proxy);

    const controller = new AbortController();
    const pending = fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      body: "{}",
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();
    await expect(pending).rejects.toThrow();
    await expect(
      Promise.race([
        aborted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("upstream was not aborted")), 1_000),
        ),
      ]),
    ).resolves.toBeUndefined();
  });

  it("aborts an in-flight translation when the client disconnects", async () => {
    let translationAborted: () => void = () => {};
    const aborted = new Promise<void>((resolve) => {
      translationAborted = resolve;
    });
    const upstream = await listen(() => ({ body: "unused" }));
    const proxy = await startAnthropicProxy({
      upstream: new URL(upstream.url),
      translator: {
        translate: (_text: string, signal?: AbortSignal) =>
          new Promise<string>((_resolve, reject) => {
            signal?.addEventListener(
              "abort",
              () => {
                translationAborted();
                reject(new Error("cancelled"));
              },
              { once: true },
            );
          }),
      },
      readEnabled: async () => true,
    });
    servers.push(proxy);

    const controller = new AbortController();
    const pending = fetch(`${proxy.baseUrl}/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: [{ type: "text", text: "고쳐줘" }] }],
      }),
      signal: controller.signal,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    controller.abort();

    await expect(pending).rejects.toThrow();
    await expect(
      Promise.race([
        aborted,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("translation was not aborted")), 1_000),
        ),
      ]),
    ).resolves.toBeUndefined();
  });
});
