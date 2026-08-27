import { describe, expect, it } from "vitest";
import { proxyBaseUrl, retryCommand } from "./proxy-service.js";
import { launchd, PROXY_LABEL, SYSTEMD_UNIT, supervisorFor, systemd } from "./supervisors.js";

const TARGET = {
  node: "/path/with &/node",
  entry: "/app/index.js",
  home: "/Users/test",
  stdout: "/tmp/proxy.log",
  stderr: "/tmp/proxy.err.log",
};

describe("persistent proxy service", () => {
  it("uses one stable loopback URL", () => {
    expect(proxyBaseUrl({ host: "127.0.0.1", port: 18789 })).toBe("http://127.0.0.1:18789");
  });

  it("launches the installed proxy independently of a Claude session", () => {
    const plist = launchd.definition(TARGET);
    expect(plist).toContain("com.klauxy.proxy");
    expect(plist).toContain("__proxy-daemon");
    expect(plist).toContain("/path/with &amp;/node");
    expect(plist).toContain("<key>KeepAlive</key><true/>");
  });

  it("retries a transient launchctl failure", async () => {
    let attempts = 0;
    const execute = async () => {
      attempts += 1;
      if (attempts < 3) throw new Error("Bootstrap failed: 5: Input/output error");
    };

    await retryCommand(execute, async () => {}, 3);

    expect(attempts).toBe(3);
  });

  it("reports the final launchctl error after exhausting retries", async () => {
    const execute = async () => {
      throw new Error("still unavailable");
    };

    await expect(retryCommand(execute, async () => {}, 2)).rejects.toThrow("still unavailable");
  });
});
describe("systemd user service", () => {
  it("runs the proxy daemon with the resolved home and restarts on failure", () => {
    const unit = systemd.definition({
      ...TARGET,
      node: "/usr/bin/node",
      entry: "/opt/klauxy/dist/index.js",
      home: "/home/dev",
    });

    expect(unit).toContain(
      "ExecStart=/usr/bin/node /opt/klauxy/dist/index.js __proxy-daemon /home/dev",
    );
    expect(unit).toContain("Environment=HOME=/home/dev");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("WantedBy=default.target");
  });

  it("names a user unit, not a system one", () => {
    expect(SYSTEMD_UNIT).toBe("klauxy-proxy.service");
  });
});

describe("supervisor selection", () => {
  it("uses launchd on macOS and systemd on Linux", () => {
    expect(supervisorFor("darwin")?.label).toBe(PROXY_LABEL);
    expect(supervisorFor("linux")?.label).toBe(SYSTEMD_UNIT);
  });

  it("reports no supervisor for an unsupported platform", () => {
    expect(supervisorFor("win32")).toBeUndefined();
  });

  it("clears a previous registration before activating", () => {
    for (const supervisor of [launchd, systemd]) {
      expect(supervisor.deactivate(501).length).toBeGreaterThan(0);
      expect(supervisor.activate("/tmp/def", 501).length).toBeGreaterThan(0);
    }
  });

  it("scopes launchd commands to the calling user's GUI domain", () => {
    const [boot] = launchd.activate("/tmp/def", 501);

    expect(boot?.args).toContain("gui/501");
  });

  it("keeps systemd commands in the user manager", () => {
    expect(systemd.activate("/tmp/def", 501).every((step) => step.args.includes("--user"))).toBe(
      true,
    );
    expect(systemd.deactivate(501).every((step) => step.args.includes("--user"))).toBe(true);
  });
});
