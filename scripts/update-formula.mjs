#!/usr/bin/env node
/**
 * Points the Homebrew formula at a published npm version.
 *
 * Homebrew pins by URL plus sha256, and the digest only exists once the tarball
 * is on the registry. Computing it by hand is the step most likely to be wrong
 * in a release, so read it back from npm instead.
 *
 *   node scripts/update-formula.mjs [version]
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = process.argv[2] ?? pkg.version;
const formulaPath = join(root, "Formula", "klauxy.rb");

function npmView(field) {
  return execFileSync("npm", ["view", `${pkg.name}@${version}`, field], {
    encoding: "utf8",
  }).trim();
}

let tarball;
let integrity;
try {
  tarball = npmView("dist.tarball");
  integrity = npmView("dist.integrity");
} catch {
  process.stderr.write(
    `${pkg.name}@${version} is not on the registry yet. Publish first, then rerun.\n`,
  );
  process.exit(1);
}

// npm reports sha512 base64 integrity; Homebrew wants a hex sha256 of the file.
const response = await fetch(tarball);
if (!response.ok) {
  process.stderr.write(`could not download ${tarball} (HTTP ${response.status})\n`);
  process.exit(1);
}
const bytes = new Uint8Array(await response.arrayBuffer());
const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
  .map((byte) => byte.toString(16).padStart(2, "0"))
  .join("");

const current = readFileSync(formulaPath, "utf8");
const updated = current
  .replace(/url ".*"/, `url "${tarball}"`)
  .replace(/sha256 ".*"/, `sha256 "${digest}"`)
  .replace(/klauxy-[0-9][^"]*\.tgz/g, `klauxy-${version}.tgz`);

if (updated === current) {
  process.stdout.write("Formula already up to date\n");
} else {
  writeFileSync(formulaPath, updated, "utf8");
  process.stdout.write(`Formula updated for ${version}\n`);
}
process.stdout.write(`  url     ${tarball}\n`);
process.stdout.write(`  sha256  ${digest}\n`);
process.stdout.write(`  npm integrity ${integrity}\n`);
