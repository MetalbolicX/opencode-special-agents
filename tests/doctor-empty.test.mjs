// tests/doctor-empty.test.mjs — Plan 009: doctor empty-install verdict regression test
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const { execPath } = process;
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

function runDoctor(args) {
  const fullArgs = ["install.mjs", "doctor", ...args];
  const result = spawnSync(execPath, fullArgs, { encoding: "utf8", cwd: REPO_ROOT });
  return result;
}

function cleanup(tmp) {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

describe("doctor empty-install verdict", () => {
  it("empty target, no state, no files → degraded with INSTALL_MISSING (json)", () => {
    const tmpTarget = mkdtempSync(join(tmpdir(), `doc-empty-${randomUUID().slice(0, 8)}-`));
    try {
      const result = runDoctor(["--scope", "project", "--root", tmpTarget, "--json"]);
      const stdout = result.stdout ?? "";
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        assert.fail(`JSON parse failed. stdout: ${JSON.stringify(stdout)}, stderr: ${JSON.stringify(result.stderr)}`);
      }
      assert.strictEqual(result.status, 1, `expected exit 1, got ${result.status}. stderr: ${result.stderr}`);
      assert.strictEqual(parsed.result, "degraded", `expected result=degraded, got: ${JSON.stringify(parsed)}`);
      const hasMissing = parsed.diagnostics?.some(
        d => d.code === "INSTALL_MISSING" && /install/i.test(d.message)
      );
      assert.ok(hasMissing, `expected INSTALL_MISSING diagnostic mentioning 'install', got: ${JSON.stringify(parsed.diagnostics)}`);
    } finally {
      cleanup(tmpTarget);
    }
  });

  it("empty target text mode → degraded with INSTALL_MISSING", () => {
    const tmpTarget = mkdtempSync(join(tmpdir(), `doc-empty-${randomUUID().slice(0, 8)}-`));
    try {
      const result = runDoctor(["--scope", "project", "--root", tmpTarget]);
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const combined = stdout + stderr;
      assert.strictEqual(result.status, 1, `expected exit 1, got ${result.status}. stderr: ${stderr}`);
      assert.ok(/degraded/i.test(combined), `output must contain 'degraded', got: ${JSON.stringify(combined)}`);
      assert.ok(/INSTALL_MISSING/i.test(combined), `output must contain INSTALL_MISSING, got: ${JSON.stringify(combined)}`);
    } finally {
      cleanup(tmpTarget);
    }
  });

  it("files present without state → degraded with INSTALL_MISSING (partial)", () => {
    const tmpTarget = mkdtempSync(join(tmpdir(), `doc-partial-${randomUUID().slice(0, 8)}-`));
    try {
      // Pre-create one manifest-dest file
      mkdirSync(join(tmpTarget, ".opencode"), { recursive: true });
      writeFileSync(join(tmpTarget, ".opencode", "agents.json"), "{}");
      const result = runDoctor(["--scope", "project", "--root", tmpTarget, "--json"]);
      const stdout = result.stdout ?? "";
      let parsed;
      try {
        parsed = JSON.parse(stdout);
      } catch {
        assert.fail(`JSON parse failed. stdout: ${JSON.stringify(stdout)}, stderr: ${JSON.stringify(result.stderr)}`);
      }
      assert.strictEqual(result.status, 1, `expected exit 1, got ${result.status}. stderr: ${result.stderr}`);
      assert.strictEqual(parsed.result, "degraded", `expected result=degraded, got: ${JSON.stringify(parsed)}`);
      const hasMissing = parsed.diagnostics?.some(d => d.code === "INSTALL_MISSING");
      assert.ok(hasMissing, `expected INSTALL_MISSING diagnostic, got: ${JSON.stringify(parsed.diagnostics)}`);
    } finally {
      cleanup(tmpTarget);
    }
  });

  it("live regression: real global install → ok / exit 0", () => {
    const result = runDoctor(["--scope", "global"]);
    const stdout = result.stdout ?? "";
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      // If it fails JSON parse, check text mode
      assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
      assert.ok(/ok/i.test(stdout), `expected 'ok' in output, got: ${JSON.stringify(stdout)}`);
      return;
    }
    assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${result.stderr}`);
    assert.strictEqual(parsed.result, "ok", `expected result=ok for live global install, got: ${JSON.stringify(parsed)}`);
  });
});
