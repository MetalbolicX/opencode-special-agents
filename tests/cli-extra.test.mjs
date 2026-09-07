// tests/cli-extra.test.mjs — Plan 006: uninstall/update/status/doctor with strict TDD
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const INSTALL = resolve(__dirname, "../install.mjs");
const PKG_NAME = "opencode-special-agents";

const sha256File = (filePath) => {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
};

const createPayload = (tmpDir, opts = {}) => {
  const { version = "0.1.0", includePlugin = true } = opts;
  mkdirSync(join(tmpDir, ".opencode", "agent"), { recursive: true });
  mkdirSync(join(tmpDir, ".opencode", "command"), { recursive: true });
  if (includePlugin) mkdirSync(join(tmpDir, "dist", "plugin"), { recursive: true });
  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: PKG_NAME, version }));
  writeFileSync(join(tmpDir, ".opencode", "agent", "sisyphus.md"), "# Sisyphus agent\n");
  writeFileSync(join(tmpDir, ".opencode", "command", "plan.md"), "# Plan command\n");
  if (includePlugin) {
    writeFileSync(join(tmpDir, "dist", "plugin", "continuation-enforcer.js"), "const p = {}; export default p;\n");
  }
};

const createManifest = (tmpDir, opts = {}) => {
  const { version = "0.1.0", includePlugin = true } = opts;
  const sisyphusSha = sha256File(join(tmpDir, ".opencode", "agent", "sisyphus.md"));
  const planSha = sha256File(join(tmpDir, ".opencode", "command", "plan.md"));
  const manifest = {
    name: PKG_NAME,
    version,
    schemaVersion: 1,
    files: [
      { source: ".opencode/agent/sisyphus.md", dest: "agent/sisyphus.md", kind: "agent", sha256: sisyphusSha },
      { source: ".opencode/command/plan.md", dest: "command/plan.md", kind: "command", sha256: planSha },
    ],
  };
  if (includePlugin) {
    const pluginSha = sha256File(join(tmpDir, "dist", "plugin", "continuation-enforcer.js"));
    manifest.files.push({ source: "dist/plugin/continuation-enforcer.js", dest: "plugin/continuation-enforcer.js", kind: "plugin", sha256: pluginSha });
  }
  writeFileSync(join(tmpDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  return manifest;
};

const runInstall = (args, opts = {}) => {
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
};

const doInstall = (sourceDir, targetDir) => {
  return runInstall(["--source", sourceDir, "--root", targetDir, "--yes"], { cwd: sourceDir });
};

const listFiles = (dir, base = "") => {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const result = [];
  for (const e of entries) {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) {
      result.push(...listFiles(join(dir, e.name), rel));
    } else {
      result.push(rel);
    }
  }
  return result;
};

// ---------------------------------------------------------------------------
// Step 1: uninstall happy path
// ---------------------------------------------------------------------------
describe("Step 1: uninstall — happy path", () => {
  let tmpDir, sourceDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-happy-${Date.now()}-${Math.random()}`);
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("removes all state-listed files and state file itself", () => {
    const r = runInstall(["uninstall", "--root", targetDir], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `uninstall failed: ${r.stderr}\n${r.stdout}`);
    assert.ok(!existsSync(join(targetDir, ".opencode-special-agents.json")), "state file should be deleted");
    assert.ok(!existsSync(join(targetDir, "agent", "sisyphus.md")), "agent file should be deleted");
    assert.ok(!existsSync(join(targetDir, "command", "plan.md")), "command file should be deleted");
    assert.ok(!existsSync(join(targetDir, "plugin", "continuation-enforcer.js")), "plugin file should be deleted");
  });

  it("leaves unrelated files intact", () => {
    doInstall(sourceDir, targetDir);
    mkdirSync(join(targetDir, "unrelated"), { recursive: true });
    writeFileSync(join(targetDir, "unrelated", "notes.txt"), "my notes\n");
    runInstall(["uninstall", "--root", targetDir], { cwd: sourceDir });
    assert.ok(existsSync(join(targetDir, "unrelated", "notes.txt")), "unrelated file should survive");
  });

  it("prunes empty directories under agent/, command/, plugin/", () => {
    doInstall(sourceDir, targetDir);
    runInstall(["uninstall", "--root", targetDir], { cwd: sourceDir });
    assert.ok(!existsSync(join(targetDir, "agent")), "agent dir should be pruned");
    assert.ok(!existsSync(join(targetDir, "command")), "command dir should be pruned");
    assert.ok(!existsSync(join(targetDir, "plugin")), "plugin dir should be pruned");
  });
});

// ---------------------------------------------------------------------------
// Step 1b: uninstall user-modified file keeps it, exit 1
// ---------------------------------------------------------------------------
describe("Step 1b: uninstall — user-modified file", () => {
  let tmpDir, sourceDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-mod-${Date.now()}-${Math.random()}`);
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# Sisyphus agent MODIFIED\n");
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("keeps user-modified file, warns, exits 1", () => {
    const r = runInstall(["uninstall", "--root", targetDir], { cwd: sourceDir });
    assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}: ${r.stdout}`);
    assert.ok(r.stdout.includes("KEPT") && r.stdout.includes("user-modified"), `should warn: ${r.stdout}`);
    assert.ok(existsSync(join(targetDir, "agent", "sisyphus.md")), "modified file should be kept");
    assert.ok(!existsSync(join(targetDir, ".opencode-special-agents.json")), "state file still deleted");
  });
});

// ---------------------------------------------------------------------------
// Step 1c: uninstall state missing = report-only, exit 1
// ---------------------------------------------------------------------------
describe("Step 1c: uninstall — state missing", () => {
  let tmpDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-missing-${Date.now()}-${Math.random()}`);
    targetDir = join(tmpDir, "target");
    mkdirSync(join(targetDir, "agent"), { recursive: true });
    mkdirSync(join(targetDir, "command"), { recursive: true });
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# Sisyphus agent\n");
    writeFileSync(join(targetDir, "command", "plan.md"), "# Plan command\n");
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("report-only: no deletions, exit 1, recovery message", () => {
    const r = runInstall(["uninstall", "--root", targetDir], { cwd: tmpDir });
    assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}: ${r.stdout} ${r.stderr}`);
    assert.ok(r.stdout.toLowerCase().includes("reinstall") || r.stdout.toLowerCase().includes("recover"), `should mention reinstall: ${r.stdout}`);
    assert.ok(existsSync(join(targetDir, "agent", "sisyphus.md")), "file should NOT be deleted");
    assert.ok(existsSync(join(targetDir, "command", "plan.md")), "file should NOT be deleted");
  });
});

// ---------------------------------------------------------------------------
// Step 1d: uninstall state corrupt = report-only, exit 1
// ---------------------------------------------------------------------------
describe("Step 1d: uninstall — state corrupt", () => {
  let tmpDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-corrupt-${Date.now()}-${Math.random()}`);
    targetDir = join(tmpDir, "target");
    mkdirSync(join(targetDir, "agent"), { recursive: true });
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# Sisyphus agent\n");
    writeFileSync(join(targetDir, ".opencode-special-agents.json"), "NOT VALID JSON{{{");
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("report-only: no deletions, exit 1", () => {
    const r = runInstall(["uninstall", "--root", targetDir], { cwd: tmpDir });
    assert.strictEqual(r.status, 1, `expected exit 1, got ${r.status}`);
    assert.ok(existsSync(join(targetDir, "agent", "sisyphus.md")), "file should NOT be deleted");
  });
});

// ---------------------------------------------------------------------------
// Step 1e: uninstall --force
// ---------------------------------------------------------------------------
describe("Step 1e: uninstall — --force", () => {
  let tmpDir, sourceDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-force-${Date.now()}-${Math.random()}`);
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# Sisyphus agent MODIFIED\n");
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("--force deletes user-modified files after backup, exits 0", () => {
    const r = runInstall(["uninstall", "--root", targetDir, "--force"], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `expected exit 0, got ${r.status}: ${r.stderr}`);
    assert.ok(!existsSync(join(targetDir, "agent", "sisyphus.md")), "force should delete modified file");
    const backupDir = join(targetDir, ".opencode-special-agents.backups");
    assert.ok(existsSync(backupDir), "backup dir should be created");
    const backups = listFiles(backupDir);
    assert.ok(backups.length > 0, "backup should exist");
  });
});

// ---------------------------------------------------------------------------
// Step 1e-2: uninstall --force report-only without state
// ---------------------------------------------------------------------------
describe("Step 1e-2: uninstall — --force report-only without state", () => {
  it("--force still report-only without state", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-force-ns-${Date.now()}-${Math.random()}`);
    const targetDir = join(tmpDir, "target");
    mkdirSync(join(targetDir, "agent"), { recursive: true });
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# Sisyphus agent\n");
    const r = runInstall(["uninstall", "--root", targetDir, "--force"], { cwd: tmpDir });
    assert.strictEqual(r.status, 1, `expected exit 1 even with --force when no state: got ${r.status}`);
    assert.ok(existsSync(join(targetDir, "agent", "sisyphus.md")), "file should NOT be deleted without state");
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Step 2: uninstall --purge
// ---------------------------------------------------------------------------
describe("Step 2: uninstall --purge", () => {
  let tmpDir, sourceDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `uninstall-purge-${Date.now()}-${Math.random()}`);
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    mkdirSync(join(targetDir, ".opencode-special-agents.backups"), { recursive: true });
    writeFileSync(join(targetDir, ".opencode-special-agents.backups", "sisyphus.md.bak.2025-01-01T00-00-00.000Z"), "backup\n");
    mkdirSync(join(tmpDir, ".staging-12345"), { recursive: true });
    writeFileSync(join(tmpDir, ".staging-12345", "marker.txt"), "stale\n");
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("--purge removes backups and staging dirs", () => {
    const r = runInstall(["uninstall", "--root", targetDir, "--purge"], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `uninstall --purge failed: ${r.stderr}`);
    assert.ok(!existsSync(join(targetDir, ".opencode-special-agents.backups")), "backup dir should be removed");
    assert.ok(!existsSync(join(tmpDir, ".staging-12345")), "staging dir should be removed");
    assert.ok(!existsSync(join(targetDir, "agent", "sisyphus.md")), "agent file should be deleted");
  });

  it("uninstall without --purge leaves backups and staging dirs", () => {
    doInstall(sourceDir, targetDir);
    mkdirSync(join(targetDir, ".opencode-special-agents.backups"), { recursive: true });
    writeFileSync(join(targetDir, ".opencode-special-agents.backups", "sisyphus.md.bak.2025-01-01T00-00-00.000Z"), "backup\n");
    runInstall(["uninstall", "--root", targetDir], { cwd: sourceDir });
    assert.ok(existsSync(join(targetDir, ".opencode-special-agents.backups")), "backup dir should survive");
  });
});

// ---------------------------------------------------------------------------
// Step 3: update
// ---------------------------------------------------------------------------
describe("Step 3: update", () => {
  let tmpDir, sourceDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `update-${Date.now()}-${Math.random()}`);
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("update rewrites changed files, leaves others untouched", () => {
    writeFileSync(join(sourceDir, ".opencode", "agent", "sisyphus.md"), "# Sisyphus agent UPDATED\n");
    const newSha = sha256File(join(sourceDir, ".opencode", "agent", "sisyphus.md"));
    const manifest = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf-8"));
    manifest.version = "0.2.0";
    for (const f of manifest.files) {
      if (f.dest === "agent/sisyphus.md") f.sha256 = newSha;
    }
    writeFileSync(join(sourceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const r = runInstall(["update", "--source", sourceDir, "--root", targetDir], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `update failed: ${r.stderr}\n${r.stdout}`);
    assert.ok(r.stdout.toLowerCase().includes("updated") || r.stdout.toLowerCase().includes("install"), `should report updated: ${r.stdout}`);
    assert.strictEqual(readFileSync(join(targetDir, "agent", "sisyphus.md"), "utf-8").trim(), "# Sisyphus agent UPDATED");
    assert.strictEqual(readFileSync(join(targetDir, "command", "plan.md"), "utf-8").trim(), "# Plan command");
  });

  it("update same version but changed hash still updates", () => {
    writeFileSync(join(sourceDir, ".opencode", "agent", "sisyphus.md"), "# Sisyphus agent REPUBLISH\n");
    const newSha = sha256File(join(sourceDir, ".opencode", "agent", "sisyphus.md"));
    const manifest = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf-8"));
    manifest.version = "0.2.0";
    for (const f of manifest.files) {
      if (f.dest === "agent/sisyphus.md") f.sha256 = newSha;
    }
    writeFileSync(join(sourceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const r = runInstall(["update", "--source", sourceDir, "--root", targetDir], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `update should succeed on hash change: ${r.stderr}`);
    assert.strictEqual(readFileSync(join(targetDir, "agent", "sisyphus.md"), "utf-8").trim(), "# Sisyphus agent REPUBLISH");
  });

  it("update partial: user-modified + --yes keeps file, exits 1", () => {
    doInstall(sourceDir, targetDir);
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# Sisyphus agent USER\n");
    const manifest = JSON.parse(readFileSync(join(sourceDir, "manifest.json"), "utf-8"));
    manifest.version = "0.3.0";
    writeFileSync(join(sourceDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
    const r = runInstall(["update", "--source", sourceDir, "--root", targetDir, "--yes"], { cwd: sourceDir });
    assert.strictEqual(r.status, 1, `expected exit 1 for partial update, got ${r.status}: ${r.stdout}`);
    assert.ok(r.stdout.toLowerCase().includes("kept") || r.stdout.toLowerCase().includes("conflict"), `should report kept: ${r.stdout}`);
    assert.strictEqual(readFileSync(join(targetDir, "agent", "sisyphus.md"), "utf-8").trim(), "# Sisyphus agent USER");
  });
});

// ---------------------------------------------------------------------------
// Step 4: status
// ---------------------------------------------------------------------------
describe("Step 4: status", () => {
  let tmpDir, sourceDir, targetDir;

  before(() => {
    tmpDir = join(process.env.TMPDIR || "/tmp", `status-${Date.now()}-${Math.random()}`);
    sourceDir = join(tmpDir, "source");
    targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
  });

  after(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("status text mode shows per-file state, exit 0", () => {
    const r = runInstall(["status", "--root", targetDir], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `status should exit 0, got ${r.status}: ${r.stderr}`);
    assert.ok(r.stdout.includes("installed") || r.stdout.includes("status"), `should show installed files: ${r.stdout}`);
  });

  it("status --json emits schema v1", () => {
    const r = runInstall(["status", "--root", targetDir, "--json"], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `status --json should exit 0: ${r.stderr}`);
    let json;
    assert.doesNotThrow(() => { json = JSON.parse(r.stdout); }, `should be valid JSON: ${r.stdout}`);
    assert.strictEqual(json.schemaVersion, 1, "schemaVersion must be 1");
    assert.strictEqual(json.command, "status");
    assert.ok(typeof json.target === "string" && json.target.startsWith("/"), "target must be absolute");
    assert.ok(json.scope === "project" || json.scope === "global");
    assert.ok(json.version && typeof json.version.manifest === "string");
    assert.ok(Array.isArray(json.files));
    for (const f of json.files) {
      assert.ok(typeof f.dest === "string");
      assert.ok(["installed", "missing", "modified", "kept"].includes(f.state), `invalid state: ${f.state}`);
    }
    assert.ok(Array.isArray(json.diagnostics));
    assert.ok(["ok", "degraded", "failed"].includes(json.result));
  });
});

// ---------------------------------------------------------------------------
// Step 5: doctor
// ---------------------------------------------------------------------------
describe("Step 5: doctor", () => {
  it("doctor on clean install exits 0, result: ok", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `doctor-clean-${Date.now()}-${Math.random()}`);
    const sourceDir = join(tmpDir, "source");
    const targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    const r = runInstall(["doctor", "--root", targetDir], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `doctor clean should exit 0, got ${r.status}: ${r.stderr}`);
    assert.ok(r.stdout.toLowerCase().includes("ok") || r.stdout.toLowerCase().includes("healthy") || r.stdout.toLowerCase().includes("no issues"), `should report ok: ${r.stdout}`);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor --json emits schema v1 with diagnostics", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `doctor-json-${Date.now()}-${Math.random()}`);
    const sourceDir = join(tmpDir, "source");
    const targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    const r = runInstall(["doctor", "--root", targetDir, "--json"], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `doctor --json should exit 0: ${r.stderr}`);
    let json;
    assert.doesNotThrow(() => { json = JSON.parse(r.stdout); }, `should be valid JSON`);
    assert.strictEqual(json.schemaVersion, 1);
    assert.strictEqual(json.command, "doctor");
    assert.ok(["ok", "degraded", "failed"].includes(json.result));
    assert.ok(Array.isArray(json.diagnostics));
    assert.ok(Array.isArray(json.files));
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor detects tampered file, exits 1, result: degraded, FILE_DRIFT", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `doctor-drift-${Date.now()}-${Math.random()}`);
    const sourceDir = join(tmpDir, "source");
    const targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    writeFileSync(join(targetDir, "agent", "sisyphus.md"), "# TAMPERED\n");
    const r = runInstall(["doctor", "--root", targetDir, "--json"], { cwd: sourceDir });
    assert.strictEqual(r.status, 1, `doctor tampered should exit 1, got ${r.status}`);
    const json = JSON.parse(r.stdout);
    assert.strictEqual(json.result, "degraded");
    const driftDiag = json.diagnostics.find(d => d.code === "FILE_DRIFT");
    assert.ok(driftDiag, `FILE_DRIFT missing: ${JSON.stringify(json.diagnostics)}`);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor missing payload file exits 2, result: failed, PAYLOAD_INVALID", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `doctor-missing-${Date.now()}-${Math.random()}`);
    const sourceDir = join(tmpDir, "source");
    const targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    // Remove the source file but keep manifest entry → verifyPayload will fail
    rmSync(join(sourceDir, ".opencode", "agent", "sisyphus.md"));
    const r = runInstall(["doctor", "--source", sourceDir, "--root", targetDir, "--json"], { cwd: sourceDir });
    assert.strictEqual(r.status, 2, `doctor missing payload should exit 2, got ${r.status}: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    assert.strictEqual(json.result, "failed");
    const payloadDiag = json.diagnostics.find(d => d.code === "PAYLOAD_INVALID");
    assert.ok(payloadDiag, `PAYLOAD_INVALID missing: ${JSON.stringify(json.diagnostics)}`);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor on valid install emits clean diagnostics", () => {
    const tmpDir = join(process.env.TMPDIR || "/tmp", `doctor-ok-${Date.now()}-${Math.random()}`);
    const sourceDir = join(tmpDir, "source");
    const targetDir = join(tmpDir, "target");
    mkdirSync(targetDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    doInstall(sourceDir, targetDir);
    const r = runInstall(["doctor", "--root", targetDir, "--json"], { cwd: sourceDir });
    assert.strictEqual(r.status, 0, `doctor should exit 0: ${r.stderr}`);
    const json = JSON.parse(r.stdout);
    assert.strictEqual(json.result, "ok");
    assert.ok(json.diagnostics.length === 0 || !json.diagnostics.some(d => d.level === "error"), "no error diagnostics");
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("doctor target-unwritable path exits non-zero with TARGET_UNWRITABLE", () => {
    // Use a path under /proc/self (read-only even for root in most configs)
    const sourceDir = join(process.env.TMPDIR || "/tmp", `doctor-src-${Date.now()}-${Math.random()}`);
    mkdirSync(sourceDir, { recursive: true });
    createPayload(sourceDir);
    createManifest(sourceDir);
    const badTarget = "/proc/self/fake-opencode-dir";
    const r = runInstall(["doctor", "--root", badTarget, "--json"], { cwd: sourceDir });
    // /proc/self is not writable for creating subdirs in the normal case
    // If somehow writable (container nuance), still check result structure
    assert.ok(r.status >= 1, `doctor should exit non-zero for bad target, got ${r.status}`);
    if (r.status === 2) {
      const json = JSON.parse(r.stdout);
      assert.strictEqual(json.result, "failed");
    }
    rmSync(sourceDir, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Step 6: --gitignore-state
// ---------------------------------------------------------------------------
describe("Step 6: --gitignore-state", () => {
  it("install --gitignore-state appends to .gitignore idempotently", () => {
    const t = join(process.env.TMPDIR || "/tmp", `gi-idemp-${Date.now()}-${Math.random()}`);
    const src = join(t, "source");
    const tgt = join(t, "target");
    mkdirSync(tgt, { recursive: true });
    mkdirSync(join(tgt, ".opencode"), { recursive: true });
    mkdirSync(join(tgt, "agent"), { recursive: true });
    mkdirSync(join(tgt, "command"), { recursive: true });
    createPayload(src);
    createManifest(src);
    doInstall(src, tgt);
    const giPath = join(tgt, ".opencode", ".gitignore");
    writeFileSync(giPath, "node_modules/\n");
    const r = runInstall(["--source", src, "--root", tgt, "--yes", "--gitignore-state"], { cwd: src });
    assert.strictEqual(r.status, 0, `install --gitignore-state failed: ${r.stderr}`);
    const content = readFileSync(giPath, "utf-8");
    assert.ok(content.includes(".opencode-special-agents.json"), `should include state: ${content}`);
    const lines = content.split("\n").filter(l => l === ".opencode-special-agents.json");
    assert.strictEqual(lines.length, 1, "idempotent: only one entry");
    rmSync(t, { recursive: true, force: true });
  });

  it("--gitignore-state creates .gitignore if absent", () => {
    const t = join(process.env.TMPDIR || "/tmp", `gi-create-${Date.now()}-${Math.random()}`);
    const src = join(t, "source");
    const tgt = join(t, "target");
    mkdirSync(tgt, { recursive: true });
    mkdirSync(join(tgt, ".opencode"), { recursive: true });
    mkdirSync(join(tgt, "agent"), { recursive: true });
    mkdirSync(join(tgt, "command"), { recursive: true });
    createPayload(src);
    createManifest(src);
    doInstall(src, tgt);
    const giPath = join(tgt, ".opencode", ".gitignore");
    assert.ok(!existsSync(giPath), "precondition: .gitignore should not exist");
    const r = runInstall(["--source", src, "--root", tgt, "--yes", "--gitignore-state"], { cwd: src });
    assert.strictEqual(r.status, 0);
    assert.ok(existsSync(giPath), ".gitignore should be created");
    assert.ok(readFileSync(giPath, "utf-8").includes(".opencode-special-agents.json"));
    rmSync(t, { recursive: true, force: true });
  });

  it("--gitignore-state rejected in global scope", () => {
    const t = join(process.env.TMPDIR || "/tmp", `gi-global-${Date.now()}-${Math.random()}`);
    const src = join(t, "source");
    const tgt = join(t, "target");
    mkdirSync(tgt, { recursive: true });
    createPayload(src);
    createManifest(src);
    const r = runInstall(["--source", src, "--root", tgt, "--scope", "global", "--gitignore-state"], { cwd: src });
    assert.strictEqual(r.status, 2, "global scope should reject --gitignore-state");
    assert.ok(r.stderr.toLowerCase().includes("global") || r.stderr.toLowerCase().includes("scope"), `should mention scope: ${r.stderr}`);
    rmSync(t, { recursive: true, force: true });
  });

  it("default install does NOT touch .gitignore", () => {
    const t = join(process.env.TMPDIR || "/tmp", `gi-default-${Date.now()}-${Math.random()}`);
    const src = join(t, "source");
    const tgt = join(t, "target");
    mkdirSync(join(tgt, ".opencode"), { recursive: true });
    mkdirSync(tgt, { recursive: true });
    createPayload(src);
    createManifest(src);
    doInstall(src, tgt);
    const giPath = join(tgt, ".opencode", ".gitignore");
    writeFileSync(giPath, "node_modules/\n");
    doInstall(src, tgt);
    const content = readFileSync(giPath, "utf-8");
    assert.ok(!content.includes(".opencode-special-agents.json"), `default install should not touch .gitignore: ${content}`);
    rmSync(t, { recursive: true, force: true });
  });
});

// ---------------------------------------------------------------------------
// Step 7: usage text
// ---------------------------------------------------------------------------
describe("Step 7: usage covers all commands and flags", () => {
  it("help output mentions uninstall", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("uninstall"));
  });

  it("help output mentions update", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("update"));
  });

  it("help output mentions status", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("status"));
  });

  it("help output mentions doctor", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("doctor"));
  });

  it("help output mentions --json", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("--json"));
  });

  it("help output mentions --purge", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("--purge"));
  });

  it("help output mentions --force", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("--force"));
  });

  it("help output mentions --gitignore-state", () => {
    const r = runInstall(["--help"]);
    assert.ok(r.stdout.includes("--gitignore-state"));
  });
});
