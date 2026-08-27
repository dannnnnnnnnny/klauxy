import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { installShim, uninstallShim } from "./install.js";
import { klauxyPaths } from "./paths.js";
import { reloadHint, shellScanPaths, shellTargets } from "./shell.js";

async function home(): Promise<string> {
  return mkdtemp(join(tmpdir(), "klauxy-shell-"));
}

describe("shell detection", () => {
  it("targets every startup file that already exists", async () => {
    const root = await home();
    await writeFile(join(root, ".zshrc"), "", "utf8");
    await writeFile(join(root, ".bashrc"), "", "utf8");

    const targets = await shellTargets(root, {});

    expect(targets.map((target) => target.path)).toEqual([
      join(root, ".zshrc"),
      join(root, ".bashrc"),
    ]);
    expect(targets.every((target) => target.syntax === "posix")).toBe(true);
  });

  it("detects a fish config and marks its syntax", async () => {
    const root = await home();
    await mkdir(join(root, ".config", "fish"), { recursive: true });
    await writeFile(join(root, ".config", "fish", "config.fish"), "", "utf8");

    const targets = await shellTargets(root, {});

    expect(targets).toEqual([
      { path: join(root, ".config", "fish", "config.fish"), syntax: "fish" },
    ]);
  });

  it("falls back to $SHELL when no startup file exists yet", async () => {
    const root = await home();

    expect(await shellTargets(root, { SHELL: "/opt/homebrew/bin/fish" })).toEqual([
      { path: join(root, ".config", "fish", "config.fish"), syntax: "fish" },
    ]);
    expect(await shellTargets(root, { SHELL: "/bin/bash" })).toEqual([
      { path: join(root, ".bashrc"), syntax: "posix" },
    ]);
    expect(await shellTargets(root, {})).toEqual([{ path: join(root, ".zshrc"), syntax: "posix" }]);
  });

  it("scans posix and fish files for a shadowing claude alias", async () => {
    const root = await home();
    const paths = shellScanPaths(root);

    expect(paths).toContain(join(root, ".zshrc"));
    expect(paths).toContain(join(root, ".bash_profile"));
    expect(paths).toContain(join(root, ".profile"));
    expect(paths).toContain(join(root, ".config", "fish", "config.fish"));
  });

  it("names the file to reload using a tilde path", async () => {
    const root = await home();
    const hint = reloadHint([{ path: join(root, ".bashrc"), syntax: "posix" }], root);

    expect(hint).toBe("Restart your shell or run: source ~/.bashrc");
  });
});

describe("PATH block syntax per shell", () => {
  it("writes an export line for posix shells", async () => {
    const root = await home();
    const rc = join(root, ".bashrc");
    await writeFile(rc, "export KEEP=1\n", "utf8");

    await installShim({
      home: root,
      realClaude: "/real/claude",
      node: "/usr/bin/node",
      entry: "/app/index.js",
      upstream: "https://api.anthropic.com",
      rcFiles: [{ path: rc, syntax: "posix" }],
    });

    const contents = await readFile(rc, "utf8");
    expect(contents).toContain(`export PATH="${klauxyPaths(root).binDir}:$PATH"`);
    expect(contents).toContain("export KEEP=1");
  });

  it("writes fish_add_path for fish, which cannot parse export", async () => {
    const root = await home();
    const config = join(root, ".config", "fish", "config.fish");
    await mkdir(join(root, ".config", "fish"), { recursive: true });
    await writeFile(config, "set -g KEEP 1\n", "utf8");

    await installShim({
      home: root,
      realClaude: "/real/claude",
      node: "/usr/bin/node",
      entry: "/app/index.js",
      upstream: "https://api.anthropic.com",
      rcFiles: [{ path: config, syntax: "fish" }],
    });

    const contents = await readFile(config, "utf8");
    expect(contents).toContain(`fish_add_path -p ${klauxyPaths(root).binDir}`);
    expect(contents).not.toContain("export PATH");
    expect(contents).toContain("set -g KEEP 1");
  });

  it("removes its block from every shell it edited", async () => {
    const root = await home();
    const rc = join(root, ".zshrc");
    const config = join(root, ".config", "fish", "config.fish");
    await mkdir(join(root, ".config", "fish"), { recursive: true });
    await writeFile(rc, "export KEEP=1\n", "utf8");
    await writeFile(config, "set -g KEEP 1\n", "utf8");
    const targets = [
      { path: rc, syntax: "posix" as const },
      { path: config, syntax: "fish" as const },
    ];

    await installShim({
      home: root,
      realClaude: "/real/claude",
      node: "/usr/bin/node",
      entry: "/app/index.js",
      upstream: "https://api.anthropic.com",
      rcFiles: targets,
    });
    await uninstallShim({ home: root, rcFiles: targets });

    expect(await readFile(rc, "utf8")).toBe("export KEEP=1\n");
    expect(await readFile(config, "utf8")).toBe("set -g KEEP 1\n");
  });
});
describe("reload hint edge cases", () => {
  it("falls back to a generic hint when there is no target", () => {
    expect(reloadHint([], "/Users/test")).toBe("Restart your shell");
  });

  it("shows an absolute path when the file lives outside home", () => {
    const hint = reloadHint([{ path: "/etc/zshrc", syntax: "posix" }], "/Users/test");

    expect(hint).toBe("Restart your shell or run: source /etc/zshrc");
  });

  it("names the fish config when fish is the target", async () => {
    const root = await mkdtemp(join(tmpdir(), "klauxy-shell-"));
    const config = join(root, ".config", "fish", "config.fish");

    expect(reloadHint([{ path: config, syntax: "fish" }], root)).toContain(
      "~/.config/fish/config.fish",
    );
  });

  it("prefers the first target when several exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "klauxy-shell-"));

    const hint = reloadHint(
      [
        { path: join(root, ".zshrc"), syntax: "posix" },
        { path: join(root, ".bashrc"), syntax: "posix" },
      ],
      root,
    );

    expect(hint).toContain("~/.zshrc");
    expect(hint).not.toContain(".bashrc");
  });

  it("ignores a SHELL value it does not recognise", async () => {
    const root = await mkdtemp(join(tmpdir(), "klauxy-shell-"));

    // An unfamiliar shell still needs a working PATH entry somewhere.
    expect(await shellTargets(root, { SHELL: "/usr/bin/exotic" })).toEqual([
      { path: join(root, ".zshrc"), syntax: "posix" },
    ]);
  });
});
