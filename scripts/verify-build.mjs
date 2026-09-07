import { readdirSync, statSync, readFileSync } from "fs";
import { join } from "path";

const distDir = "dist";

const files = readdirSync(distDir).flatMap((d) => {
  const p = join(distDir, d);
  if (statSync(p).isDirectory()) {
    return readdirSync(p).map((f) => join(p, f));
  }
  return [p];
});

if (files.length !== 1) {
  console.error(`FAIL: Expected exactly 1 file in dist/, found ${files.length}: ${files.join(", ")}`);
  process.exit(1);
}

const artifact = files[0];
const content = readFileSync(artifact, "utf-8");

if (/^import\s/m.test(content)) {
  console.error(`FAIL: Bundle contains top-level import statements (runtime deps)`);
  process.exit(1);
}

const stat = statSync(artifact);
if (stat.size === 0) {
  console.error(`FAIL: Artifact is empty`);
  process.exit(1);
}

console.log(`PASS: dist/ has exactly 1 file (${stat.size} bytes), no runtime imports`);
