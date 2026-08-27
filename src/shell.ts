import { access } from "node:fs/promises";
import { join } from "node:path";

/**
 * Shell integration targets.
 *
 * Klauxy has to put its bin directory on PATH, and which file does that depends
 * on the user's shell. Rather than assume zsh, pick every startup file that
 * plausibly applies so the install works the same on a stock macOS zsh, a
 * bash-on-Intel setup, or a fish user's machine.
 */

export interface ShellTarget {
  /** Absolute path to the startup file. */
  path: string;
  /** Syntax family; fish cannot parse POSIX `export`. */
  syntax: "posix" | "fish";
}

const POSIX_FILES = [".zshrc", ".bashrc", ".bash_profile", ".profile"] as const;

function fishConfig(home: string): string {
  return join(home, ".config", "fish", "config.fish");
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Startup files to edit for this user.
 *
 * Existing files always win. When none exist, fall back to the file matching
 * `$SHELL` so a fresh account still gets a working PATH entry.
 */
export async function shellTargets(
  home: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ShellTarget[]> {
  const targets: ShellTarget[] = [];
  for (const name of POSIX_FILES) {
    const path = join(home, name);
    if (await exists(path)) targets.push({ path, syntax: "posix" });
  }
  const fishPath = fishConfig(home);
  if (await exists(fishPath)) targets.push({ path: fishPath, syntax: "fish" });

  if (targets.length > 0) return targets;

  const shell = env.SHELL ?? "";
  if (shell.endsWith("/fish")) return [{ path: fishPath, syntax: "fish" }];
  if (shell.endsWith("/bash")) return [{ path: join(home, ".bashrc"), syntax: "posix" }];
  return [{ path: join(home, ".zshrc"), syntax: "posix" }];
}

/** Startup files to scan for a `claude` alias that would bypass the shim. */
export function shellScanPaths(home: string): string[] {
  return [...POSIX_FILES.map((name) => join(home, name)), fishConfig(home)];
}

/** Human-readable hint naming the file the user should reload after install. */
export function reloadHint(targets: ShellTarget[], home: string): string {
  const first = targets[0];
  if (first === undefined) return "Restart your shell";
  const display = first.path.startsWith(home)
    ? ["~", first.path.slice(home.length)].join("")
    : first.path;
  return ["Restart your shell or run: source ", display].join("");
}
