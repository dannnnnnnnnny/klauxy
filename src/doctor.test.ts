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
