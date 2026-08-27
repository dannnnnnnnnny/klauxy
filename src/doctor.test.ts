import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { diagnose } from "./doctor.js";

const servers: ReturnType<typeof createServer>[] = [];
afterEach(async () => {
  await Promise.all(
    servers
      .splice(0)
      .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
  );
});

describe("doctor", () => {
  it("reports a reachable oMLX model and Claude executable", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: [{ id: "Qwen3-8B-4bit" }] }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    const port = (server.address() as AddressInfo).port;
    const result = await diagnose({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v22.0.0",
      claude: "/bin/sh",
      host: ["http://127.0.0.1:", port].join(""),
      model: "Qwen3-8B-4bit",
      timeoutMs: 1000,
    });
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toContain("Qwen3-8B-4bit");
  });

  it("reports unreachable oMLX without throwing", async () => {
    const result = await diagnose({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v22",
      claude: "/bin/sh",
      host: "http://127.0.0.1:1",
      model: "x",
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("oMLX: failed");
  });

  it("warns when a shell alias can bypass the shim", async () => {
    const result = await diagnose({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v22",
      claude: "/bin/sh",
      host: "http://127.0.0.1:1",
      model: "x",
      timeoutMs: 20,
      shellDefinitions: ["alias claude='/other/claude'\n"],
    });
    expect(result.lines.join("\n")).toContain("alias/function named claude");
  });
});
describe("provider diagnosis detail", () => {
  const servers: ReturnType<typeof createServer>[] = [];
  afterEach(async () => {
    await Promise.all(
      servers
        .splice(0)
        .map((server) => new Promise<void>((resolve) => server.close(() => resolve()))),
    );
  });

  async function modelsServer(models: string[]) {
    const server = createServer((request, response) => {
      request.resume();
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ data: models.map((id) => ({ id })) }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("names the missing model when the provider serves others", async () => {
    const host = await modelsServer(["llama3:8b", "mistral:7b"]);

    const result = await diagnose({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v22.0.0",
      claude: "/bin/sh",
      provider: "ollama",
      host,
      model: "qwen2.5:7b",
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("model not found: qwen2.5:7b");
  });

  it("accepts a provider that lists no models rather than failing", async () => {
    // Some servers return an empty list until a model is first requested.
    const host = await modelsServer([]);

    const result = await diagnose({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v22.0.0",
      claude: "/bin/sh",
      provider: "ollama",
      host,
      model: "qwen2.5:7b",
      timeoutMs: 1000,
    });

    expect(result.ok).toBe(true);
  });

  it("fails Node older than the supported floor", async () => {
    const result = await diagnose({
      platform: "darwin",
      arch: "arm64",
      nodeVersion: "v18.19.0",
      claude: "/bin/sh",
      provider: "ollama",
      host: "http://127.0.0.1:1",
      model: "m",
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    expect(result.lines.join("\n")).toContain("requires 20+");
  });

  it("directs Intel Mac users to ollama instead of oMLX", async () => {
    const result = await diagnose({
      platform: "darwin",
      arch: "x64",
      nodeVersion: "v22.0.0",
      claude: "/bin/sh",
      provider: "omlx",
      host: "http://127.0.0.1:1",
      model: "m",
      timeoutMs: 20,
    });

    expect(result.lines.join("\n")).toContain("klx provider ollama");
  });
});
