import { build } from "esbuild";
import { spawnSync } from "node:child_process";

const outfile = "/tmp/aetherion-crafty-tests.cjs";
await build({
  entryPoints: ["src/lib/crafty.test.ts"],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const result = spawnSync(process.execPath, ["--test", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);