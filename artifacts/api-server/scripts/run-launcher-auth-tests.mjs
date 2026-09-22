import { build } from "esbuild";
import { spawnSync } from "node:child_process";

const outfile = "/tmp/aetherion-launcher-auth-tests.cjs";
await build({
  entryPoints: ["src/lib/launcherAuth.test.ts"],
  outfile,
  bundle: true,
  format: "cjs",
  platform: "node",
});

const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", outfile], { stdio: "inherit" });
process.exit(result.status ?? 1);
