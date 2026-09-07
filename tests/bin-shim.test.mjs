// tests/bin-shim.test.mjs — Plan 009: bin-shim guard regression test
import { describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import { symlinkSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const { execPath } = process;
const REPO_ROOT = fileURLToPath(new URL("../", import.meta.url));

function runThroughSymlink(scriptPath, args) {
  const tmp = mkdtempSync(join(tmpdir(), `bin-shim-test-${randomUUID().slice(0, 8)}-`));
  const linkPath = join(tmp, "bin-link");
  symlinkSync(scriptPath, linkPath);
  const result = spawnSync(execPath, [linkPath, ...args], { encoding: "utf8" });
  return { result, tmp };
}

function cleanup(tmp) {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
}

describe("bin-shim regression", () => {
  it("help through symlink prints non-empty output and exits 0", () => {
    const { result, tmp } = runThroughSymlink(join(REPO_ROOT, "install.mjs"), ["--help"]);
    try {
      const stdout = result.stdout ?? "";
      const stderr = result.stderr ?? "";
      const combined = stdout + stderr;
      assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${stderr}`);
      assert.ok(combined.length > 0, "stdout+stderr must be non-empty through symlink");
      assert.ok(/usage/i.test(combined), "output must contain Usage hint");
    } finally {
      cleanup(tmp);
    }
  });

  it("subcommand through symlink prints status header", () => {
    const tmpTarget = mkdtempSync(join(tmpdir(), `bin-shim-status-${randomUUID().slice(0, 8)}-`));
    mkdirSync(join(tmpTarget, ".opencode"), { recursive: true });
    try {
      const { result, tmp } = runThroughSymlink(join(REPO_ROOT, "install.mjs"), [
        "status",
        "--scope", "project",
        "--root", tmpTarget,
        "--source", REPO_ROOT,
      ]);
      try {
        const stdout = result.stdout ?? "";
        const stderr = result.stderr ?? "";
        const combined = stdout + stderr;
        assert.strictEqual(result.status, 0, `expected exit 0, got ${result.status}. stderr: ${stderr}`);
        assert.ok(combined.length > 0, "stdout+stderr must be non-empty through symlink");
        assert.ok(/target:/i.test(combined), `output must contain 'Target:' header; got: ${JSON.stringify(combined)}`);
      } finally {
        cleanup(tmp);
      }
    } finally {
      rmSync(tmpTarget, { recursive: true, force: true });
    }
  });
});
