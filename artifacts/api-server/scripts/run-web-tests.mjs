import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

const outfile = path.join(tmpdir(), "aetherion-web-tests.cjs");
await build({
  entryPoints: ["src/lib/web.test.ts"],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
