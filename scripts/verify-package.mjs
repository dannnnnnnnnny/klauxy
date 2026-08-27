#!/usr/bin/env node
/**
 * Packs the tarball, installs it into a throwaway prefix, and runs the CLI.
 *
 * Catches the class of release bug that unit tests cannot see: a missing entry
 * in `files`, a bin path that does not resolve, or a runtime dependency that was
 * only ever present because it sat in devDependencies locally.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const workdir = mkdtempSync(join(tmpdir(), "klauxy-verify-"));
const home = mkdtempSync(join(tmpdir(), "klauxy-verify-home-"));

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf8",
    cwd: options.cwd ?? workdir,
    env: { ...process.env, ...options.env },
    stdio: options.inherit ? "inherit" : "pipe",
  });
}

let failures = 0;
function check(label, condition, detail = "") {
  if (condition) {
    process.stdout.write(`ok   ${label}\n`);
  } else {
    failures += 1;
    process.stdout.write(`FAIL ${label}${detail ? `: ${detail}` : ""}\n`);
  }
}

try {
  const packed = run("npm", ["pack", root, "--silent"]).trim().split("\n").at(-1);
  const tarball = join(workdir, packed);

  run("npm", ["install", "--prefix", join(workdir, "prefix"), "--no-audit", "--no-fund", tarball]);
  const bin = join(workdir, "prefix", "node_modules", ".bin");

  for (const name of Object.keys(pkg.bin ?? {})) {
    const version = run(join(bin, name), ["--version"], { env: { HOME: home } }).trim();
    check(`${name} --version reports ${pkg.version}`, version === pkg.version, version);
  }

  const help = run(join(bin, "klx"), ["--help"], { env: { HOME: home } });
  check("klx --help lists commands", help.includes("Usage:") && help.includes("init"));

  const providers = run(join(bin, "klx"), ["provider"], { env: { HOME: home } });
  check(
    "klx provider lists every backend",
    ["omlx", "ollama", "opencode"].every((id) => providers.includes(id)),
  );

  // Unknown commands must fail loudly rather than exiting 0.
  let unknownExit = 0;
  try {
    run(join(bin, "klx"), ["definitely-not-a-command"], { env: { HOME: home } });
  } catch (error) {
    unknownExit = error.status ?? 0;
  }
  check("unknown command exits non-zero", unknownExit === 1, String(unknownExit));

  const installed = join(workdir, "prefix", "node_modules", pkg.name);
  for (const required of ["LICENSE", "README.md", "dist/index.js"]) {
    let present = true;
    try {
      readFileSync(join(installed, required));
    } catch {
      present = false;
    }
    check(`package ships ${required}`, present);
  }

  // Only declared runtime dependencies may land next to the package. Read the
  // installed tree from disk: `npm ls` treats a tarball install as "invalid"
  // and exits non-zero even when the layout is correct.
  const declared = new Set(Object.keys(pkg.dependencies ?? {}));
  const modules = join(workdir, "prefix", "node_modules");
  const installedNames = [];
  for (const entry of readdirSync(modules, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (entry.name.startsWith(".") || entry.name === pkg.name) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of readdirSync(join(modules, entry.name))) {
        installedNames.push(`${entry.name}/${scoped}`);
      }
      continue;
    }
    installedNames.push(entry.name);
  }
  const unexpected = installedNames.filter((name) => !declared.has(name));
  check(
    `runtime dependencies limited to ${[...declared].join(", ") || "none"}`,
    unexpected.length === 0,
    unexpected.join(", "),
  );
} finally {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}

if (failures > 0) {
  process.stdout.write(`\n${failures} package check(s) failed\n`);
  process.exitCode = 1;
} else {
  process.stdout.write("\nPackage verified\n");
}
