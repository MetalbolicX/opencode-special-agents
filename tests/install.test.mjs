import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL = resolve(__dirname, "../install.mjs");

// ---------------------------------------------------------------------------
// Helper: sha256 of file contents
// ---------------------------------------------------------------------------
function sha256File(filePath) {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Helper: create a complete payload fixture in a tmp directory
// ---------------------------------------------------------------------------
function createPayload(tmpDir, opts = {}) {
  const { name = "test-pkg", version = "0.1.0", includePlugin = true } = opts;
  mkdirSync(join(tmpDir, ".opencode", "agent"), { recursive: true });
  mkdirSync(join(tmpDir, ".opencode", "command"), { recursive: true });
  if (includePlugin) mkdirSync(join(tmpDir, "dist", "plugin"), { recursive: true });

  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name, version }));
  writeFileSync(join(tmpDir, ".opencode", "agent", "sisyphus.md"), "# Sisyphus agent\n");
  writeFileSync(join(tmpDir, ".opencode", "command", "plan.md"), "# Plan command\n");
  if (includePlugin) {
    writeFileSync(join(tmpDir, "dist", "plugin", "continuation-enforcer.js"), "const p = {}; export default p;\n");
  }
}

// ---------------------------------------------------------------------------
// Helper: run install.mjs with args in a given cwd
// ---------------------------------------------------------------------------
function runInstall(args, opts = {}) {
  const { cwd = process.cwd(), env = {}, input = undefined } = opts;
  const result = spawnSync(process.execPath, [INSTALL, ...args], {
    cwd,
    env: { ...process.env, ...env },
    input,
  });
  return {
    stdout: result.stdout?.toString() ?? "",
    stderr: result.stderr?.toString() ?? "",
    status: result.status,
    signal: result.signal,
  };
}

// ---------------------------------------------------------------------------
// Step 1: CLI skeleton
// ---------------------------------------------------------------------------
describe("Step 1: CLI skeleton", () => {
  it("no args prints usage and exits 0", () => {
    const r = runInstall([]);
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);
    assert.ok(r.stdout.includes("Usage") || r.stdout.includes("install"), "should print usage");
  });

  it("-h/--help prints usage and exits 0", () => {
    for (const arg of ["-h", "--help"]) {
      const r = runInstall([arg]);
      assert.strictEqual(r.status, 0, `${arg} should exit 0`);
      assert.ok(r.stdout.includes("Usage") || r.stdout.includes("install"), "should print usage");
    }
  });

  it("unknown command prints error and exits 2", () => {
    const r = runInstall(["unknown-cmd"]);
    assert.strictEqual(r.status, 2, `expected 2, got ${r.status}`);
    assert.ok(r.stderr.includes("unknown") || r.stderr.includes("Unknown"), "should print error");
  });

  it("--dry-run is accepted syntactically", () => {
    const r = runInstall(["--dry-run"]);
    // Should not crash on parse; exit code 0 or plan output
    assert.strictEqual(r.status, 0, `--dry-run should be accepted: ${r.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// Step 2: Source resolution
// ---------------------------------------------------------------------------
describe("Step 2: Source resolution", () => {
  let tmpDir;
  let manifestContent;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `src-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    createPayload(tmpDir);
    // Write a valid manifest
    const sisyphusSha = createHash("sha256").update("# Sisyphus agent\n").digest("hex");
    const planSha = createHash("sha256").update("# Plan command\n").digest("hex");
    const pluginSha = createHash("sha256").update("const p = {}; export default p;\n").digest("hex");
    manifestContent = JSON.stringify({
      name: "opencode-special-agents",
      version: "0.1.0",
      schemaVersion: 1,
      files: [
        { source: ".opencode/agent/sisyphus.md", dest: "agent/sisyphus.md", kind: "agent", sha256: sisyphusSha },
        { source: ".opencode/command/plan.md", dest: "command/plan.md", kind: "command", sha256: planSha },
        { source: "dist/plugin/continuation-enforcer.js", dest: "plugin/continuation-enforcer.js", kind: "plugin", sha256: pluginSha },
      ],
    }, null, 2);
    writeFileSync(join(tmpDir, "manifest.json"), manifestContent);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("walk-up from cwd finds manifest.json with matching name", () => {
    const r = runInstall(["--dry-run"], { cwd: tmpDir });
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);
  });

  it("--source overrides walk-up", () => {
    const r = runInstall(["--source", tmpDir, "--dry-run"]);
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);
  });

  it("foreign manifest (wrong name) is rejected exit 2", () => {
    // Write manifest with different name
    const foreign = JSON.parse(manifestContent);
    foreign.name = "other-pkg";
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(foreign, null, 2));
    const r = runInstall(["--dry-run"], { cwd: tmpDir });
    assert.strictEqual(r.status, 2, `expected 2, got ${r.status}: ${r.stderr}`);
    assert.ok(r.stderr.includes("identity") || r.stderr.includes("name") || r.stderr.includes("Foreign"), r.stderr);
  });

  it("manifest with wrong schemaVersion is rejected exit 2", () => {
    const badSchema = JSON.parse(manifestContent);
    badSchema.schemaVersion = 99;
    badSchema.name = "test-pkg";
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(badSchema, null, 2));
    const r = runInstall(["--dry-run"], { cwd: tmpDir });
    assert.strictEqual(r.status, 2, `expected 2, got ${r.status}: ${r.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// Step 3: Target resolution (unit tests via import)
// ---------------------------------------------------------------------------
describe("Step 3: Target resolution", () => {
  let resolveTargetDir;

  before(async () => {
    ({ resolveTargetDir } = await import("../install.mjs"));
  });

  it("default target is <cwd>/.opencode/", () => {
    const result = resolveTargetDir({ scope: "project", cwd: "/tmp/test" });
    assert.strictEqual(result, "/tmp/test/.opencode/");
  });

  it("--scope global targets $OPENCODE_CONFIG_DIR or ~/.config/opencode/", () => {
    const result = resolveTargetDir({ scope: "global", env: { OPENCODE_CONFIG_DIR: "" }, home: "/home/user" });
    assert.ok(result.includes(".config/opencode/"), `got: ${result}`);
  });

  it("--root overrides both scope and default", () => {
    const result = resolveTargetDir({ scope: "project", rootArg: "/custom/root", cwd: "/tmp/test" });
    assert.strictEqual(result, "/custom/root/");
  });

  it("$OPENCODE_CONFIG_DIR takes precedence over ~/.config/opencode/", () => {
    const result = resolveTargetDir({ scope: "global", env: { OPENCODE_CONFIG_DIR: "/my/config" }, home: "/home/user" });
    assert.strictEqual(result, "/my/config/");
  });
});

// ---------------------------------------------------------------------------
// Step 4: Install plan (pure functions)
// ---------------------------------------------------------------------------
describe("Step 4: Install plan", () => {
  let planInstall, resolveConflict;

  before(async () => {
    ({ planInstall, resolveConflict } = await import("../install.mjs"));
  });

  it("fresh target → all dispositions create", () => {
    const manifest = {
      name: "test",
      version: "1.0.0",
      files: [
        { dest: "agent/test.md", sha256: "abc123", kind: "agent" },
      ],
    };
    const result = planInstall(manifest, [], { plugin: true });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].disposition, "create");
  });

  it("identical sha present → unchanged", () => {
    const manifest = {
      name: "test",
      version: "1.0.0",
      files: [
        { dest: "agent/test.md", sha256: "abc123", kind: "agent" },
      ],
    };
    const existing = [{ dest: "agent/test.md", sha256: "abc123" }];
    const result = planInstall(manifest, existing, { plugin: true });
    assert.strictEqual(result[0].disposition, "unchanged");
  });

  it("different sha present → conflict", () => {
    const manifest = {
      name: "test",
      version: "1.0.0",
      files: [
        { dest: "agent/test.md", sha256: "abc123", kind: "agent" },
      ],
    };
    const existing = [{ dest: "agent/test.md", sha256: "xyz789" }];
    const result = planInstall(manifest, existing, { plugin: true });
    assert.strictEqual(result[0].disposition, "conflict");
  });

  it("--plugin off excludes kind=plugin entries", () => {
    const manifest = {
      name: "test",
      version: "1.0.0",
      files: [
        { dest: "agent/test.md", sha256: "abc123", kind: "agent" },
        { dest: "plugin/test.js", sha256: "def456", kind: "plugin" },
      ],
    };
    const result = planInstall(manifest, [], { plugin: false });
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].dest, "agent/test.md");
  });

  it("resolveConflict: --yes returns keep", () => {
    const result = resolveConflict("conflict", { yes: true, tty: true });
    assert.strictEqual(result, "keep");
  });

  it("resolveConflict: non-TTY returns keep", () => {
    const result = resolveConflict("conflict", { yes: false, tty: false });
    assert.strictEqual(result, "keep");
  });

  it("resolveConflict: interactive TTY returns prompt (function)", () => {
    const result = resolveConflict("conflict", { yes: false, tty: true });
    assert.strictEqual(typeof result, "function");
  });
});

// ---------------------------------------------------------------------------
// Step 5: Transaction apply (spawn tests against tmpdir)
// ---------------------------------------------------------------------------
describe("Step 5: Transaction apply", () => {
  let tmpDir;
  let manifestContent;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `txn-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    createPayload(tmpDir);
    const sisyphusSha = createHash("sha256").update("# Sisyphus agent\n").digest("hex");
    const planSha = createHash("sha256").update("# Plan command\n").digest("hex");
    const pluginSha = createHash("sha256").update("const p = {}; export default p;\n").digest("hex");
    manifestContent = JSON.stringify({
      name: "opencode-special-agents",
      version: "0.1.0",
      schemaVersion: 1,
      files: [
        { source: ".opencode/agent/sisyphus.md", dest: "agent/sisyphus.md", kind: "agent", sha256: sisyphusSha },
        { source: ".opencode/command/plan.md", dest: "command/plan.md", kind: "command", sha256: planSha },
        { source: "dist/plugin/continuation-enforcer.js", dest: "plugin/continuation-enforcer.js", kind: "plugin", sha256: pluginSha },
      ],
    }, null, 2);
    writeFileSync(join(tmpDir, "manifest.json"), manifestContent);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("happy path: files land at dest, state file exists", () => {
    const targetDir = join(tmpDir, ".opencode-install-target");
    mkdirSync(targetDir, { recursive: true });
    const r = runInstall(["--source", tmpDir, "--root", targetDir]);
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);

    // Check files exist
    assert.ok(existsSync(join(targetDir, "agent/sisyphus.md")), "agent file should exist");
    assert.ok(existsSync(join(targetDir, "command/plan.md")), "command file should exist");
    assert.ok(existsSync(join(targetDir, "plugin/continuation-enforcer.js")), "plugin file should exist");

    // Check state file
    const stateFile = join(targetDir, ".opencode-special-agents.json");
    assert.ok(existsSync(stateFile), "state file should exist");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    assert.strictEqual(state.schemaVersion, 1);
    assert.strictEqual(state.name, "opencode-special-agents");
    assert.ok(Array.isArray(state.files));

    rmSync(targetDir, { recursive: true, force: true });
  });

  it("idempotent second run: zero writes", () => {
    const targetDir = join(tmpDir, ".opencode-idempotent");
    mkdirSync(targetDir, { recursive: true });
    // First install
    runInstall(["--source", tmpDir, "--root", targetDir]);
    // Snapshot mtimes
    const mtimes = [];
    for (const subdir of ["agent", "command", "plugin"]) {
      const dir = join(targetDir, subdir);
      if (!existsSync(dir)) continue;
      for (const f of readdirSync(dir)) {
        mtimes.push({ f, mtime: statSync(join(dir, f)).mtimeMs });
      }
    }
    // Second install
    const beforeMtimes = mtimes.map(({ f, mtime }) => mtime);
    runInstall(["--source", tmpDir, "--root", targetDir]);
    const afterMtimes = mtimes.map(({ f, mtime }) => {
      const dir = join(targetDir, "agent");
      if (existsSync(join(dir, f))) return statSync(join(dir, f)).mtimeMs;
      const dir2 = join(targetDir, "command");
      if (existsSync(join(dir2, f))) return statSync(join(dir2, f)).mtimeMs;
      const dir3 = join(targetDir, "plugin");
      if (existsSync(join(dir3, f))) return statSync(join(dir3, f)).mtimeMs;
      return mtime;
    });
    assert.deepStrictEqual(afterMtimes, beforeMtimes, "mtimes should be unchanged on second run");
    rmSync(targetDir, { recursive: true, force: true });
  });

  it("crash recovery: no-state + stale staging → re-run completes", () => {
    const targetDir = join(tmpDir, ".opencode-crash");
    mkdirSync(targetDir, { recursive: true });
    // Simulate interrupted install: files exist but NO state file
    mkdirSync(join(targetDir, "agent"), { recursive: true });
    writeFileSync(join(targetDir, "agent/sisyphus.md"), "# Sisyphus agent\n");
    // Stale staging dir
    const stagingDir = join(tmpDir, ".staging-99999");
    mkdirSync(stagingDir, { recursive: true });
    writeFileSync(join(stagingDir, "orphan.txt"), "stale");

    const r = runInstall(["--source", tmpDir, "--root", targetDir]);
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);

    // State file should be written
    const stateFile = join(targetDir, ".opencode-special-agents.json");
    assert.ok(existsSync(stateFile), "state file should exist after recovery");

    // Stale staging should be cleaned
    assert.ok(!existsSync(stagingDir), "stale staging dir should be cleaned up");

    rmSync(targetDir, { recursive: true, force: true });
    rmSync(stagingDir, { recursive: true, force: true });
  });

  it("--dry-run: zero filesystem mutations", () => {
    const targetDir = join(tmpDir, ".opencode-dryrun");
    mkdirSync(targetDir, { recursive: true });
    // Snapshot whole tree
    const snapshot = [];
    function snapshotDir(dir) {
      if (!existsSync(dir)) return;
      for (const f of readdirSync(dir)) {
        const full = join(dir, f);
        snapshot.push({ full, mtime: statSync(full).mtimeMs });
      }
    }
    snapshotDir(targetDir);

    const r = runInstall(["--source", tmpDir, "--root", targetDir, "--dry-run"]);
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);
    assert.ok(r.stdout.includes("create") || r.stdout.includes("plan") || r.stdout.includes("dry-run"), "dry-run should print plan");

    // Verify no changes
    let changed = false;
    for (const { full, mtime } of snapshot) {
      if (existsSync(full) && statSync(full).mtimeMs !== mtime) changed = true;
    }
    assert.ok(!changed, "dry-run should not modify filesystem");

    rmSync(targetDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Step 6: Conflict UX
// ---------------------------------------------------------------------------
describe("Step 6: Conflict UX", () => {
  let tmpDir;
  let manifestContent;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `conflict-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    createPayload(tmpDir);
    const sisyphusSha = createHash("sha256").update("# Sisyphus agent\n").digest("hex");
    const planSha = createHash("sha256").update("# Plan command\n").digest("hex");
    const pluginSha = createHash("sha256").update("const p = {}; export default p;\n").digest("hex");
    manifestContent = JSON.stringify({
      name: "opencode-special-agents",
      version: "0.1.0",
      schemaVersion: 1,
      files: [
        { source: ".opencode/agent/sisyphus.md", dest: "agent/sisyphus.md", kind: "agent", sha256: sisyphusSha },
        { source: ".opencode/command/plan.md", dest: "command/plan.md", kind: "command", sha256: planSha },
        { source: "dist/plugin/continuation-enforcer.js", dest: "plugin/continuation-enforcer.js", kind: "plugin", sha256: pluginSha },
      ],
    }, null, 2);
    writeFileSync(join(tmpDir, "manifest.json"), manifestContent);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("non-TTY: modified target file is KEPT, state records kept", () => {
    const targetDir = join(tmpDir, ".opencode-conflict");
    mkdirSync(join(targetDir, "agent"), { recursive: true });

    // First install: establish state with correct content
    writeFileSync(join(targetDir, "agent/sisyphus.md"), "# Sisyphus agent\n");
    runInstall(["--source", tmpDir, "--root", targetDir]);
    // State file now records sha256 of "# Sisyphus agent\n"

    // User modifies the file (different content, same path)
    writeFileSync(join(targetDir, "agent/sisyphus.md"), "# MODIFIED Sisyphus agent\n");
    const originalContent = readFileSync(join(targetDir, "agent/sisyphus.md"), "utf-8");
    assert.strictEqual(originalContent, "# MODIFIED Sisyphus agent\n", "setup: modified file should exist");

    // Re-run install in non-TTY mode — should keep the user-modified file
    const r = runInstall(["--source", tmpDir, "--root", targetDir], { env: { ...process.env, FORCE_COLOR: "" } });
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);

    // File should be KEPT (not overwritten)
    const afterContent = readFileSync(join(targetDir, "agent/sisyphus.md"), "utf-8");
    assert.strictEqual(afterContent, originalContent, "user-modified file should be kept");

    // State should record "kept"
    const stateFile = join(targetDir, ".opencode-special-agents.json");
    const state = JSON.parse(readFileSync(stateFile, "utf-8"));
    const keptEntry = state.files.find((f) => f.dest === "agent/sisyphus.md");
    assert.strictEqual(keptEntry?.disposition, "kept", `expected kept, got ${keptEntry?.disposition}`);

    // Warning should be printed
    assert.ok(r.stdout.includes("KEPT") || r.stdout.includes("kept"), "should warn about kept file");

    rmSync(targetDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Step 7: Self-install guard
// ---------------------------------------------------------------------------
describe("Step 7: Self-install guard", () => {
  let tmpDir;
  let manifestContent;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `selfinstall-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    createPayload(tmpDir, { name: "test-pkg" });
    // Create a fake .opencode/ inside the source that would be the target
    mkdirSync(join(tmpDir, ".opencode", "agent"), { recursive: true });
    writeFileSync(join(tmpDir, ".opencode", "agent", "sisyphus.md"), "# Sisyphus agent\n");
    const sisyphusSha = createHash("sha256").update("# Sisyphus agent\n").digest("hex");
    const planSha = createHash("sha256").update("# Plan command\n").digest("hex");
    const pluginSha = createHash("sha256").update("const p = {}; export default p;\n").digest("hex");
    manifestContent = JSON.stringify({
      name: "opencode-special-agents",
      version: "0.1.0",
      schemaVersion: 1,
      files: [
        { source: ".opencode/agent/sisyphus.md", dest: "agent/sisyphus.md", kind: "agent", sha256: sisyphusSha },
        { source: ".opencode/command/plan.md", dest: "command/plan.md", kind: "command", sha256: planSha },
        { source: "dist/plugin/continuation-enforcer.js", dest: "plugin/continuation-enforcer.js", kind: "plugin", sha256: pluginSha },
      ],
    }, null, 2);
    writeFileSync(join(tmpDir, "manifest.json"), manifestContent);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("self-install detected → exit 2 with message", () => {
    // Target the source's own .opencode/ dir
    const targetDir = join(tmpDir, ".opencode");
    const r = runInstall(["--source", tmpDir, "--root", targetDir]);
    assert.strictEqual(r.status, 2, `expected 2, got ${r.status}: ${r.stderr}`);
    assert.ok(r.stderr.includes("self-install") || r.stderr.includes("selfinstall") || r.stderr.includes("own"), r.stderr);
  });

  it("--allow-self-install bypasses guard", () => {
    const targetDir = join(tmpDir, ".opencode");
    const r = runInstall(["--source", tmpDir, "--root", targetDir, "--allow-self-install"]);
    assert.strictEqual(r.status, 0, `expected 0, got ${r.status}: ${r.stderr}`);
    rmSync(targetDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Step 8: Integration / bin wiring
// ---------------------------------------------------------------------------
describe("Step 8: Bin wiring and package scripts", () => {
  it("install.mjs has no third-party imports", () => {
    const src = readFileSync(resolve(__dirname, "../install.mjs"), "utf-8");
    const importLines = src.split("\n").filter((l) => l.startsWith("import ") && l.includes(" from "));
    for (const line of importLines) {
      const match = line.match(/from\s+["']([^"']+)["']/);
      if (!match) continue;
      const spec = match[1];
      assert.ok(
        spec.startsWith("./") || spec.startsWith("../") || spec.startsWith("node:") || spec === "node:module",
        `Unexpected import: ${line}`
      );
    }
  });

  it("shebang is present", () => {
    const src = readFileSync(resolve(__dirname, "../install.mjs"), "utf-8");
    assert.ok(src.startsWith("#!/usr/bin/env node"), "install.mjs must have node shebang");
  });

  it("--scope global and --scope project work", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `scope-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    createPayload(tmpDir);
    const sisyphusSha = createHash("sha256").update("# Sisyphus agent\n").digest("hex");
    const planSha = createHash("sha256").update("# Plan command\n").digest("hex");
    const pluginSha = createHash("sha256").update("const p = {}; export default p;\n").digest("hex");
    writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify({
      name: "opencode-special-agents",
      version: "0.1.0",
      schemaVersion: 1,
      files: [
        { source: ".opencode/agent/sisyphus.md", dest: "agent/sisyphus.md", kind: "agent", sha256: sisyphusSha },
        { source: ".opencode/command/plan.md", dest: "command/plan.md", kind: "command", sha256: planSha },
        { source: "dist/plugin/continuation-enforcer.js", dest: "plugin/continuation-enforcer.js", kind: "plugin", sha256: pluginSha },
      ],
    }, null, 2));

    const targetDir = join(tmpDir, ".opencode-scope");
    mkdirSync(targetDir, { recursive: true });

    const r1 = runInstall(["--source", tmpDir, "--root", targetDir, "--scope", "project"]);
    assert.strictEqual(r1.status, 0, `project scope: ${r1.stderr}`);

    const r2 = runInstall(["--source", tmpDir, "--root", targetDir, "--scope", "global"]);
    assert.strictEqual(r2.status, 0, `global scope: ${r2.stderr}`);

    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Unified diff helper (unit)
// ---------------------------------------------------------------------------
describe("Unified diff helper", () => {
  let unifiedDiff;

  before(async () => {
    ({ unifiedDiff } = await import("../install.mjs"));
  });

  it("produces expected +/- lines for known input", () => {
    const oldLines = ["line 1", "line 2", "line 3"];
    const newLines = ["line 1", "modified line 2", "line 3"];
    const diff = unifiedDiff(oldLines, newLines, { context: 2 });
    assert.ok(diff.includes("-line 2"), `expected -line 2 in diff: ${diff}`);
    assert.ok(diff.includes("+modified line 2"), `expected +modified in diff: ${diff}`);
  });

  it("returns empty string for identical inputs", () => {
    const lines = ["a", "b"];
    const diff = unifiedDiff(lines, lines, { context: 2 });
    assert.strictEqual(diff, "");
  });
});
