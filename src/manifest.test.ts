import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { chooseUpstream, DEFAULT_UPSTREAM, detectUpstream, readManifest } from "./manifest.js";
import { klauxyPaths } from "./paths.js";
import { proxyBaseUrl } from "./proxy-service.js";

const GATEWAY = "https://gateway.example.com";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "klauxy-manifest-"));
}

describe("upstream selection", () => {
  it("falls back to Anthropic when nothing is configured", () => {
    expect(
      chooseUpstream({ environment: undefined, claudeSettings: undefined, manifest: undefined }),
    ).toBe(DEFAULT_UPSTREAM);
  });

  it("prefers an explicit environment variable", () => {
    expect(
      chooseUpstream({
        environment: GATEWAY,
        claudeSettings: "https://other.example.com",
        manifest: "https://third.example.com",
      }),
    ).toBe(GATEWAY);
  });

  it("uses Claude settings when the environment is unset", () => {
    expect(
      chooseUpstream({ environment: undefined, claudeSettings: GATEWAY, manifest: undefined }),
    ).toBe(GATEWAY);
  });

  it("falls back to a previously recorded upstream", () => {
    expect(
      chooseUpstream({ environment: undefined, claudeSettings: undefined, manifest: GATEWAY }),
    ).toBe(GATEWAY);
  });

  it("never adopts Klauxy's own proxy, which would loop", () => {
    const self = proxyBaseUrl();

    expect(
      chooseUpstream({ environment: self, claudeSettings: undefined, manifest: undefined }),
    ).toBe(DEFAULT_UPSTREAM);
    expect(
      chooseUpstream({ environment: self, claudeSettings: GATEWAY, manifest: undefined }),
    ).toBe(GATEWAY);
  });

  it("rejects the legacy proxy origin as well", () => {
    expect(
      chooseUpstream({
        environment: "http://127.0.0.1:18789",
        claudeSettings: undefined,
        manifest: undefined,
      }),
    ).toBe(DEFAULT_UPSTREAM);
  });

  it("ignores an empty string", () => {
    expect(chooseUpstream({ environment: "", claudeSettings: GATEWAY, manifest: undefined })).toBe(
      GATEWAY,
    );
  });
});

describe("manifest reading", () => {
  it("rejects a manifest missing required fields", async () => {
    const root = await home();
    const path = join(root, "install.json");
    await writeFile(path, JSON.stringify({ realClaude: "/bin/claude" }), "utf8");

    await expect(readManifest(path)).rejects.toThrow("incomplete");
  });

  it("tells an uninstalled user to run setup instead of leaking ENOENT", async () => {
    const root = await home();

    await expect(readManifest(join(root, "missing.json"))).rejects.toThrow("klx setup");
  });

  it("reports corruption separately from absence", async () => {
    const root = await home();
    const path = join(root, "install.json");
    await writeFile(path, "{ not json", "utf8");

    await expect(readManifest(path)).rejects.toThrow("corrupted");
  });

  it("returns a complete manifest", async () => {
    const root = await home();
    const path = join(root, "install.json");
    await writeFile(
      path,
      JSON.stringify({ realClaude: "/bin/claude", entry: "/app/index.js", upstream: GATEWAY }),
      "utf8",
    );

    expect(await readManifest(path)).toMatchObject({ upstream: GATEWAY });
  });
});

describe("upstream detection from disk", () => {
  it("reads the upstream recorded by a previous install", async () => {
    const root = await home();
    const paths = klauxyPaths(root, "darwin");
    await mkdir(paths.configDir, { recursive: true });
    await writeFile(
      paths.manifest,
      JSON.stringify({ realClaude: "/bin/claude", entry: "/app/index.js", upstream: GATEWAY }),
      "utf8",
    );

    expect(await detectUpstream(paths, {})).toBe(GATEWAY);
  });

  it("defaults to Anthropic on a clean machine", async () => {
    const paths = klauxyPaths(await home(), "darwin");

    expect(await detectUpstream(paths, {})).toBe(DEFAULT_UPSTREAM);
  });
});
