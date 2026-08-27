/**
 * Per-platform process supervisors.
 *
 * The proxy has to outlive any single `claude` invocation so background workers
 * reach the same translation endpoint. Each platform expresses that differently,
 * so the differences live in one table here rather than as `if (platform ===`
 * branches spread through the install path. Adding a platform means adding an
 * entry, not editing the install flow.
 */

export interface SupervisorTarget {
  node: string;
  entry: string;
  home: string;
  stdout: string;
  stderr: string;
}

export interface Supervisor {
  /** Identifier used in log messages and service lookups. */
  label: string;
  /** Definition file contents. */
  definition(target: SupervisorTarget): string;
  /** Commands to run after writing the definition, in order. */
  activate(definitionPath: string, uid: number): Array<{ command: string; args: string[] }>;
  /** Commands to run when removing the service; failures are ignored. */
  deactivate(uid: number): Array<{ command: string; args: string[] }>;
}

export const PROXY_LABEL = "com.klauxy.proxy";
export const SYSTEMD_UNIT = "klauxy-proxy.service";

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export const launchd: Supervisor = {
  label: PROXY_LABEL,
  definition: (target) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>${PROXY_LABEL}</string>
<key>ProgramArguments</key><array><string>${xml(target.node)}</string><string>${xml(target.entry)}</string><string>__proxy-daemon</string><string>${xml(target.home)}</string></array>
<key>EnvironmentVariables</key><dict><key>HOME</key><string>${xml(target.home)}</string></dict>
<key>RunAtLoad</key><true/>
<key>KeepAlive</key><true/>
<key>ProcessType</key><string>Interactive</string>
<key>StandardOutPath</key><string>${xml(target.stdout)}</string>
<key>StandardErrorPath</key><string>${xml(target.stderr)}</string>
</dict></plist>
`,
  activate: (definitionPath, uid) => [
    { command: "launchctl", args: ["bootstrap", `gui/${uid}`, definitionPath] },
    { command: "launchctl", args: ["kickstart", "-k", `gui/${uid}/${PROXY_LABEL}`] },
  ],
  deactivate: (uid) => [{ command: "launchctl", args: ["bootout", `gui/${uid}/${PROXY_LABEL}`] }],
};

export const systemd: Supervisor = {
  label: SYSTEMD_UNIT,
  // A user unit, so nothing here needs root.
  definition: (target) => `[Unit]
Description=Klauxy Anthropic translation proxy
After=network.target

[Service]
Type=simple
ExecStart=${target.node} ${target.entry} __proxy-daemon ${target.home}
Environment=HOME=${target.home}
Restart=always
RestartSec=1

[Install]
WantedBy=default.target
`,
  activate: () => [
    { command: "systemctl", args: ["--user", "daemon-reload"] },
    { command: "systemctl", args: ["--user", "enable", SYSTEMD_UNIT] },
    { command: "systemctl", args: ["--user", "restart", SYSTEMD_UNIT] },
  ],
  deactivate: () => [
    { command: "systemctl", args: ["--user", "disable", "--now", SYSTEMD_UNIT] },
    { command: "systemctl", args: ["--user", "daemon-reload"] },
  ],
};

/** Supervisor for a platform, or undefined when Klauxy cannot keep a service alive there. */
export function supervisorFor(platform: NodeJS.Platform): Supervisor | undefined {
  if (platform === "darwin") return launchd;
  if (platform === "linux") return systemd;
  return undefined;
}
