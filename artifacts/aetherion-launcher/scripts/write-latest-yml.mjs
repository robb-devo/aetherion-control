import { createHash } from "node:crypto";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const releaseDir = join(root, "release");
const exeName = `AETHERION-Launcher-${pkg.version}.exe`;
const exePath = join(releaseDir, exeName);
const data = readFileSync(exePath);
const sha512 = createHash("sha512").update(data).digest("base64");
const size = statSync(exePath).size;
const yml = [
  `version: ${pkg.version}`,
  "files:",
  `  - url: ${exeName}`,
  `    sha512: ${JSON.stringify(sha512)}`,
  `    size: ${size}`,
  `path: ${exeName}`,
  `sha512: ${JSON.stringify(sha512)}`,
  `releaseDate: '${new Date().toISOString()}'`,
  "",
].join("\n");

writeFileSync(join(releaseDir, "latest.yml"), yml);
console.log(`Wrote release/latest.yml for ${exeName} (${size} bytes)`);
