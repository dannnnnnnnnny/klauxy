import { mkdir, mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
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
describe("staging the runtime", () => {
  async function source(dependencies: Record<string, string> = {}) {
    const root = await mkdtemp(join(tmpdir(), "klauxy-runtime-src-"));
    await mkdir(join(root, "dist"), { recursive: true });
    await writeFile(join(root, "dist", "index.js"), "// entry\n", "utf8");
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "klauxy", version: "0.1.0", dependencies }),
      "utf8",
    );
    return root;
  }

  async function addModule(
    root: string,
    name: string,
    dependencies: Record<string, string> = {},
  ): Promise<void> {
    const dir = join(root, "node_modules", name);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.js"), `// ${name}\n`, "utf8");
    await writeFile(join(dir, "package.json"), JSON.stringify({ name, dependencies }), "utf8");
  }

  it("copies dist and the manifest", async () => {
    const root = await source();
    const destination = join(await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-")), "runtime");

    await installRuntime(root, destination);

    expect(await readFile(join(destination, "dist", "index.js"), "utf8")).toContain("entry");
    expect(JSON.parse(await readFile(join(destination, "package.json"), "utf8")).name).toBe(
      "klauxy",
    );
  });

  it("copies declared runtime dependencies", async () => {
    const root = await source({ "@iarna/toml": "2.2.5" });
    await addModule(root, "@iarna/toml");
    const destination = join(await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-")), "runtime");

    await installRuntime(root, destination);

    expect(
      await readFile(join(destination, "node_modules", "@iarna", "toml", "index.js"), "utf8"),
    ).toContain("@iarna/toml");
  });

  it("follows transitive dependencies so the copy can actually run", async () => {
    const root = await source({ direct: "1.0.0" });
    await addModule(root, "direct", { nested: "1.0.0" });
    await addModule(root, "nested");
    const destination = join(await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-")), "runtime");

    await installRuntime(root, destination);

    expect(
      await readFile(join(destination, "node_modules", "nested", "index.js"), "utf8"),
    ).toContain("nested");
  });

  it("survives a dependency cycle", async () => {
    const root = await source({ a: "1.0.0" });
    await addModule(root, "a", { b: "1.0.0" });
    await addModule(root, "b", { a: "1.0.0" });
    const destination = join(await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-")), "runtime");

    await expect(installRuntime(root, destination)).resolves.toBeUndefined();
  });

  it("tolerates a dependency without package metadata", async () => {
    const root = await source({ vendored: "1.0.0" });
    const dir = join(root, "node_modules", "vendored");
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "index.js"), "// vendored\n", "utf8");
    const destination = join(await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-")), "runtime");

    await installRuntime(root, destination);

    expect(
      await readFile(join(destination, "node_modules", "vendored", "index.js"), "utf8"),
    ).toContain("vendored");
  });

  it("replaces an existing install instead of merging into it", async () => {
    const root = await source();
    const destination = join(await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-")), "runtime");
    await mkdir(join(destination, "dist"), { recursive: true });
    await writeFile(join(destination, "dist", "stale.js"), "// old\n", "utf8");

    await installRuntime(root, destination);

    // A leftover file from an older version would be loaded by the new entry.
    await expect(readFile(join(destination, "dist", "stale.js"), "utf8")).rejects.toThrow();
  });

  it("leaves no staging directory behind", async () => {
    const root = await source();
    const parent = await mkdtemp(join(tmpdir(), "klauxy-runtime-dst-"));
    const destination = join(parent, "runtime");

    await installRuntime(root, destination);

    const remaining = await readdir(parent);
    expect(remaining).toEqual(["runtime"]);
  });
});
