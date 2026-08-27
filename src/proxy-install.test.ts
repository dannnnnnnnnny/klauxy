import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  installProxyService,
  uninstallLegacyProxyService,
  uninstallProxyService,
} from "./proxy-service.js";

interface Call {
  command: string;
  args: string[];
}

function recorder(fail?: (call: Call, index: number) => boolean) {
  const calls: Call[] = [];
  const run = async (command: string, args: string[]): Promise<void> => {
    const index = calls.length;
    calls.push({ command, args });
    if (fail?.({ command, args }, index)) throw new Error(`${command} failed`);
  };
  return { calls, run };
}

async function target(platform: "darwin" | "linux") {
  const home = await mkdtemp(join(tmpdir(), "klauxy-service-"));
  return {
    path: join(home, platform === "linux" ? "klauxy.service" : "com.klauxy.proxy.plist"),
    node: "/usr/bin/node",
    entry: "/opt/klauxy/dist/index.js",
    home,
    stdout: join(home, "logs", "proxy.log"),
    stderr: join(home, "logs", "proxy.err.log"),
    platform,
    retryDelayMs: 0,
  };
}

describe("installing the proxy service", () => {
  it("writes a LaunchAgent and registers it on macOS", async () => {
    const options = await target("darwin");
    const { calls, run } = recorder();

    await installProxyService({ ...options, run });

    const plist = await readFile(options.path, "utf8");
    expect(plist).toContain("com.klauxy.proxy");
    expect(plist).toContain("__proxy-daemon");
    expect(calls.every((call) => call.command === "launchctl")).toBe(true);
    expect(calls.map((call) => call.args[0])).toEqual(["bootout", "bootstrap", "kickstart"]);
  });

  it("writes a systemd unit and enables it on Linux", async () => {
    const options = await target("linux");
    const { calls, run } = recorder();

    await installProxyService({ ...options, run });

    expect(await readFile(options.path, "utf8")).toContain("ExecStart=/usr/bin/node");
    expect(calls.every((call) => call.command === "systemctl")).toBe(true);
    expect(calls.every((call) => call.args.includes("--user"))).toBe(true);
  });

  it("creates the log directory before registering", async () => {
    const options = await target("darwin");
    const { run } = recorder();

    await installProxyService({ ...options, run });

    // Registration would fail later if the supervisor could not open the logs.
    await expect(writeFile(options.stdout, "", "utf8")).resolves.toBeUndefined();
  });

  it("tolerates a failing cleanup step so a first install still works", async () => {
    const options = await target("darwin");
    const { calls, run } = recorder((call) => call.args[0] === "bootout");

    await expect(installProxyService({ ...options, run })).resolves.toBeUndefined();
    expect(calls.map((call) => call.args[0])).toContain("bootstrap");
  });

  it("retries a transient activation failure", async () => {
    const options = await target("darwin");
    let bootstraps = 0;
    const { run } = recorder((call) => {
      if (call.args[0] !== "bootstrap") return false;
      bootstraps += 1;
      return bootstraps < 3;
    });

    await installProxyService({ ...options, run });

    expect(bootstraps).toBe(3);
  });

  it("surfaces an activation failure that never clears", async () => {
    const options = await target("darwin");
    const { run } = recorder((call) => call.args[0] === "bootstrap");

    await expect(installProxyService({ ...options, run })).rejects.toThrow("launchctl failed");
  });

  it("refuses a platform it cannot supervise", async () => {
    const options = await target("darwin");
    const { run } = recorder();

    await expect(
      installProxyService({ ...options, platform: "win32" as NodeJS.Platform, run }),
    ).rejects.toThrow("cannot supervise");
  });
});

describe("uninstalling the proxy service", () => {
  it("deregisters and removes the definition on macOS", async () => {
    const options = await target("darwin");
    const { calls, run } = recorder();
    await installProxyService({ ...options, run });

    await uninstallProxyService(options.path, "darwin", run);

    expect(calls.at(-1)?.args[0]).toBe("bootout");
    await expect(readFile(options.path, "utf8")).rejects.toThrow();
  });

  it("disables the unit on Linux", async () => {
    const options = await target("linux");
    const { calls, run } = recorder();
    await installProxyService({ ...options, run });

    await uninstallProxyService(options.path, "linux", run);

    expect(calls.some((call) => call.args.includes("disable"))).toBe(true);
    await expect(readFile(options.path, "utf8")).rejects.toThrow();
  });

  it("still removes the file when deregistration fails", async () => {
    const options = await target("darwin");
    const { run: install } = recorder();
    await installProxyService({ ...options, run: install });
    const { run } = recorder(() => true);

    await uninstallProxyService(options.path, "darwin", run);

    await expect(readFile(options.path, "utf8")).rejects.toThrow();
  });

  it("is a no-op on a platform with no supervisor", async () => {
    const options = await target("darwin");
    const { calls, run } = recorder();

    await uninstallProxyService(options.path, "win32" as NodeJS.Platform, run);

    expect(calls).toHaveLength(0);
  });

  it("removes a legacy KAgent LaunchAgent", async () => {
    const home = await mkdtemp(join(tmpdir(), "klauxy-legacy-"));
    const { calls, run } = recorder();

    await uninstallLegacyProxyService(home, run);

    expect(calls[0]?.args.join(" ")).toContain("com.kagent.proxy");
  });
});
