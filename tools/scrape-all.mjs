import { spawnSync } from "node:child_process";

const scripts = [
  "tools/scrape-wechat.mjs",
  "tools/scrape-csu-bridge-center.mjs",
  "tools/scrape-weibo.mjs",
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [script], {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

const validation = spawnSync(process.execPath, ["tools/validate-items.mjs"], {
  stdio: "inherit",
  env: process.env,
});

process.exit(validation.status || 0);
