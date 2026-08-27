import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installRuntime } from "./runtime-install.js";

describe("runtime installation", () => {
  it("copies built application and production dependencies", async () => {
    const root = await mkdtemp(join(tmpdir(), "kagent-source-"));
    const destination = await mkdtemp(join(tmpdir(), "kagent-runtime-"));
    const { mkdir } = await import("node:fs/promises");
    await mkdir(join(root, "dist"));
    await mkdir(join(root, "node_modules", "dep"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "ok", "utf8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ dependencies: { dep: "1.0.0" } }),
      "utf8",
    );
    await writeFile(join(root, "node_modules", "dep", "index.js"), "dep", "utf8");
    await installRuntime(root, destination);
    expect(await readFile(join(destination, "dist", "index.js"), "utf8")).toBe("ok");
    expect(await readFile(join(destination, "node_modules", "dep", "index.js"), "utf8")).toBe(
      "dep",
    );
  });
});
