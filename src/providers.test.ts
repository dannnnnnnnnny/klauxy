import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import {
  createTranslator,
  isProviderId,
  modelsEndpoint,
  PROVIDER_IDS,
  probeProvider,
  providerDefinition,
} from "./providers.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

async function fakeChatServer(handler: (body: unknown) => unknown) {
  const requests: unknown[] = [];
  const server = createServer((request, response) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const body = raw.length > 0 ? JSON.parse(raw) : undefined;
      requests.push({ url: request.url, body });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(handler(body)));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  const { port } = server.address() as AddressInfo;
  return { host: ["http://127.0.0.1:", port].join(""), requests };
}

describe("provider registry", () => {
  it("exposes omlx, ollama, and opencode", () => {
    expect(PROVIDER_IDS).toEqual(["omlx", "ollama", "opencode"]);
  });

  it("validates provider ids", () => {
    expect(isProviderId("ollama")).toBe(true);
    expect(isProviderId("gpt4")).toBe(false);
    expect(isProviderId(undefined)).toBe(false);
  });

  it("gives each provider a distinct default host", () => {
    const hosts = PROVIDER_IDS.map((id) => providerDefinition(id).defaultHost);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("builds the models endpoint without duplicating slashes", () => {
    expect(modelsEndpoint("ollama", "http://127.0.0.1:11434/")).toBe(
      "http://127.0.0.1:11434/v1/models",
    );
  });

  it("sends the oMLX thinking flag but omits it for ollama", async () => {
    const fake = await fakeChatServer(() => ({
      choices: [{ message: { content: "Explain the structure." } }],
    }));
    const base = {
      host: fake.host,
      model: "m",
      timeout_ms: 1000,
      max_tokens: 64,
      system_prompt: "Translate only.",
    };

    await createTranslator({ ...base, provider: "omlx" }).translate("구조 설명해줘");
    await createTranslator({ ...base, provider: "ollama" }).translate("구조 설명해줘");

    const [omlxCall, ollamaCall] = fake.requests as Array<{
      url: string;
      body: Record<string, unknown>;
    }>;
    expect(omlxCall?.url).toBe("/v1/chat/completions");
    expect(omlxCall?.body.chat_template_kwargs).toEqual({ enable_thinking: false });
    expect(ollamaCall?.body.chat_template_kwargs).toBeUndefined();
    expect(ollamaCall?.body.temperature).toBe(0);
    expect(ollamaCall?.body.stream).toBe(false);
  });

  it("names the failing provider in error messages", async () => {
    const fake = await fakeChatServer(() => ({ choices: [] }));
    const translator = createTranslator({
      provider: "ollama",
      host: fake.host,
      model: "m",
      timeout_ms: 1000,
      max_tokens: 64,
      system_prompt: "Translate only.",
    });
    await expect(translator.translate("번역해줘")).rejects.toThrow("malformed Ollama response");
  });

  it("probes a reachable provider and lists models", async () => {
    const fake = await fakeChatServer(() => ({ data: [{ id: "qwen2.5:7b" }] }));
    const result = await probeProvider("ollama", fake.host, 1000);
    expect(result.reachable).toBe(true);
    expect(result.models).toContain("qwen2.5:7b");
  });

  it("reports an unreachable provider without throwing", async () => {
    const result = await probeProvider("omlx", "http://127.0.0.1:1", 50);
    expect(result.reachable).toBe(false);
    expect(result.models).toEqual([]);
    expect(result.error).toBeTruthy();
  });
});
