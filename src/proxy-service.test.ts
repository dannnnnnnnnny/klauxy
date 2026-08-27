import { describe, expect, it } from "vitest";
import {
  launchAgentPlist,
  proxyBaseUrl,
  retryCommand,
  SYSTEMD_UNIT,
  systemdUnit,
} from "./proxy-service.js";

describe("persistent proxy service", () => {
  it("uses one stable loopback URL", () => {
    expect(proxyBaseUrl({ host: "127.0.0.1", port: 18789 })).toBe("http://127.0.0.1:18789");
  });

  it("launches the installed proxy independently of a Claude session", () => {
    const plist = launchAgentPlist({
      node: "/path/with &/node",
      entry: "/app/index.js",
      home: "/Users/test",
      stdout: "/tmp/proxy.log",
      stderr: "/tmp/proxy.err.log",
    });
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
    const unit = systemdUnit({
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
