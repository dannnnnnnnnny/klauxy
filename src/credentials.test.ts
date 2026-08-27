import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ChatTranslator } from "./chat-translator.js";
import { probeProvider, providerApiKey } from "./providers.js";

const CANARY = "sk-canary-must-never-appear";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function recordingServer(status: number, body: unknown) {
  const seen: Array<Record<string, string>> = [];
  const server = createServer((request, response) => {
    seen.push({ ...(request.headers as Record<string, string>) });
    request.resume();
    request.on("end", () => {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { host: ["http://127.0.0.1:", port].join(""), seen };
}

function options(host: string, key?: string) {
  return {
    host,
    model: "m",
    timeout_ms: 1000,
    max_tokens: 32,
    system_prompt: "Translate only.",
    label: "OpenAI-compatible",
    ...(key === undefined ? {} : { api_key: key }),
  };
}

describe("provider credential handling", () => {
  it("reads the key from the environment, not from config", () => {
    expect(providerApiKey("openai-compatible", { KLAUXY_API_KEY: CANARY })).toBe(CANARY);
    expect(providerApiKey("openai-compatible", {})).toBeUndefined();
    expect(providerApiKey("openai-compatible", { KLAUXY_API_KEY: "   " })).toBeUndefined();
  });

  it("reports no key for providers that do not use one", () => {
    expect(providerApiKey("ollama", { KLAUXY_API_KEY: CANARY })).toBeUndefined();
    expect(providerApiKey("omlx", { OMLX_API_KEY: CANARY })).toBeUndefined();
  });

  it("sends the key as a bearer token when present", async () => {
    const fake = await recordingServer(200, { choices: [{ message: { content: "Hello." } }] });
    await new ChatTranslator(options(fake.host, CANARY)).translate("안녕");

    expect(fake.seen[0]?.authorization).toBe(["Bearer ", CANARY].join(""));
  });

  it("omits the authorization header when no key is configured", async () => {
    const fake = await recordingServer(200, { choices: [{ message: { content: "Hello." } }] });
    await new ChatTranslator(options(fake.host)).translate("안녕");

    expect(fake.seen[0]?.authorization).toBeUndefined();
  });

  it("keeps the key out of error messages on failure", async () => {
    const fake = await recordingServer(401, { error: "unauthorized" });
    const translator = new ChatTranslator(options(fake.host, CANARY));

    await expect(translator.translate("안녕")).rejects.toThrow(
      expect.objectContaining({
        message: expect.not.stringContaining(CANARY) as unknown as string,
      }),
    );
  });

  it("keeps the key out of error messages on timeout", async () => {
    const slow = createServer((request, response) => {
      request.resume();
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      }, 200);
    });
    await new Promise<void>((resolve) => slow.listen(0, "127.0.0.1", resolve));
    servers.push(slow);
    const host = ["http://127.0.0.1:", (slow.address() as AddressInfo).port].join("");

    const translator = new ChatTranslator({ ...options(host, CANARY), timeout_ms: 20 });
    const error = await translator.translate("안녕").catch((cause: unknown) => cause);

    expect(String(error)).not.toContain(CANARY);
    expect(String(error)).toContain("timed out");
  });
});
describe("probing a provider that needs a key", () => {
  it("sends the key when probing an authenticated provider", async () => {
    const seen: Array<Record<string, string>> = [];
    const server = createServer((request, response) => {
      seen.push({ ...(request.headers as Record<string, string>) });
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "local-model" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    process.env.KLAUXY_API_KEY = CANARY;
    try {
      const result = await probeProvider("openai-compatible", host, 1000);
      expect(result.reachable).toBe(true);
      expect(seen[0]?.authorization).toBe(`Bearer ${CANARY}`);
    } finally {
      delete process.env.KLAUXY_API_KEY;
    }
  });

  it("omits the header for a provider that takes no key", async () => {
    const seen: Array<Record<string, string>> = [];
    const server = createServer((request, response) => {
      seen.push({ ...(request.headers as Record<string, string>) });
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    process.env.KLAUXY_API_KEY = CANARY;
    try {
      await probeProvider("ollama", host, 1000);
      expect(seen[0]?.authorization).toBeUndefined();
    } finally {
      delete process.env.KLAUXY_API_KEY;
    }
  });

  it("keeps the key out of a probe failure message", async () => {
    process.env.KLAUXY_API_KEY = CANARY;
    try {
      const result = await probeProvider("openai-compatible", "http://127.0.0.1:1", 200);

      expect(result.reachable).toBe(false);
      expect(JSON.stringify(result)).not.toContain(CANARY);
    } finally {
      delete process.env.KLAUXY_API_KEY;
    }
  });

  it("reports an unhealthy provider by status, not as reachable", async () => {
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(401, { "content-type": "application/json" });
      response.end("{}");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const result = await probeProvider("ollama", host, 1000);

    expect(result.reachable).toBe(false);
    expect(result.error).toContain("401");
  });

  it("ignores malformed model entries rather than failing the probe", async () => {
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "good" }, { id: 42 }, {}] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const host = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    expect(await probeProvider("ollama", host, 1000)).toEqual({
      reachable: true,
      models: ["good"],
    });
  });
});
describe("cancellation before a request starts", () => {
  it("rejects immediately when the signal is already aborted", async () => {
    const translator = new ChatTranslator(options("http://127.0.0.1:1", CANARY));
    const controller = new AbortController();
    controller.abort();

    // No request should be attempted at all.
    await expect(translator.translate("안녕", controller.signal)).rejects.toThrow("cancelled");
  });

  it("keeps the key out of the already-aborted message", async () => {
    const translator = new ChatTranslator(options("http://127.0.0.1:1", CANARY));
    const controller = new AbortController();
    controller.abort();

    const error = await translator.translate("안녕", controller.signal).catch((cause) => cause);

    expect(String(error)).not.toContain(CANARY);
  });

  it("returns the whole reply when the envelope appears more than once", async () => {
    const echoed = ["<source_text>a</source_text>", "<source_text>b</source_text>"].join("\n");
    const fake = await recordingServer(200, {
      choices: [{ message: { content: echoed } }],
    });

    // Ambiguous output must not be silently truncated to one fragment.
    await expect(new ChatTranslator(options(fake.host)).translate("안녕")).resolves.toBe(echoed);
  });
});
