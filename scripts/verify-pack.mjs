import { spawnSync } from "child_process";

const REQUIRED_FILES = [
  ".opencode/agent/hephaestus.md",
  ".opencode/agent/librarian.md",
  ".opencode/agent/metis.md",
  ".opencode/agent/momus.md",
  ".opencode/agent/oracle.md",
  ".opencode/agent/prometheus.md",
  ".opencode/agent/scout.md",
  ".opencode/agent/sisyphus.md",
  ".opencode/command/plan.md",
  ".opencode/command/review-plan.md",
  ".opencode/command/ultrawork.md",
  "dist/plugin/continuation-enforcer.js",
  "manifest.json",
  "install.mjs",
  "LICENSE",
];

// npm pack --dry-run triggers the prepack script (build+manifest+test).
// stdout = prepack output; npm notices go to stderr.
const result = spawnSync("npm", ["pack", "--dry-run"], { encoding: "utf-8" });
const packOutput = result.stderr || "";

// Parse "npm notice <size>  <path>" lines from stderr
const npmLineRe = /^npm notice\s+\S+\s+(.+)$/;
// Only accept paths that look like files: must contain '/' (sub-directory paths like
// .opencode/agent/... or dist/...) OR be a known root file.  This excludes bare tokens
// like "0.1.0", "name@0.1.0", etc.
const KNOWN_ROOT_FILES = new Set(["LICENSE", "README.md", "package.json", "manifest.json", "install.mjs"]);

const isFilePath = (p) => {
  if (KNOWN_ROOT_FILES.has(p)) return true;
  // Must contain a slash (subdirectory path) and end with a real extension
  if (!p.includes("/")) return false;
  if (!/\.[a-z0-9]{1,10}$/i.test(p)) return false;
  if (p.endsWith(".tgz")) return false;
  return true;
};

const files = packOutput
  .split("\n")
  .map((l) => {
    const m = l.match(npmLineRe);
    return m ? m[1].trim() : null;
  })
  .filter((f) => f && isFilePath(f));

const assertions = [];
let passCount = 0;
let failCount = 0;

const assert = (condition, message) => {
  if (condition) {
    assertions.push(`  PASS: ${message}`);
    passCount++;
  } else {
    assertions.push(`  FAIL: ${message}`);
    failCount++;
  }
}

// Required files
for (const required of REQUIRED_FILES) {
  const found = files.some((f) => f === required);
  assert(found, `required file present: ${required}`);
}

// Total file count < 40
assert(
  files.length < 40,
  `total file count (${files.length}) < 40 — no payload leakage`
);

console.log("=== Pack verification ===");
for (const a of assertions) console.log(a);
console.log(
  `\n${passCount} passed, ${failCount} failed out of ${REQUIRED_FILES.length + 1} assertions`
);

if (failCount > 0) {
  console.log("\nFiles included in pack:");
  for (const f of files) console.log("  " + f);
  process.exit(1);
}

console.log("\nPASS: all assertions passed");
process.exit(0);
