import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, readdirSync, statSync } from "fs";
import { join, resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Helper: compute sha256 of a file
// ---------------------------------------------------------------------------
const sha256File = (path) => {
  const data = readFileSync(path);
  return createHash("sha256").update(data).digest("hex");
};

// ---------------------------------------------------------------------------
// Helper: create a temp directory with payload fixtures
// ---------------------------------------------------------------------------
const createTempPayload = (tmpDir) => {
  mkdirSync(join(tmpDir, ".opencode", "agent"), { recursive: true });
  mkdirSync(join(tmpDir, ".opencode", "command"), { recursive: true });
  mkdirSync(join(tmpDir, "dist", "plugin"), { recursive: true });

  writeFileSync(join(tmpDir, "package.json"), JSON.stringify({ name: "test-pkg", version: "0.0.1" }));
  writeFileSync(join(tmpDir, ".opencode", "agent", "sisyphus.md"), "# Sisyphus\n");
  writeFileSync(join(tmpDir, ".opencode", "command", "plan.md"), "# Plan\n");
  writeFileSync(join(tmpDir, "dist", "plugin", "continuation-enforcer.js"), "const plugin = {};\nexport default plugin;\n");
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("manifest generation", () => {
  let tmpDir;
  let generateManifest;

  before(async () => {
    // Require the generator (will fail until implemented)
    try {
      ({ generateManifest } = await import("../scripts/gen-manifest.mjs"));
    } catch {
      // Module not yet implemented — tests will fail
    }
    tmpDir = join(process.env.TMPDIR || "/tmp", `manifest-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    createTempPayload(tmpDir);
  });

  after(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("produces schema v1 manifest with correct structure", () => {
    const manifest = generateManifest(tmpDir);
    assert.strictEqual(manifest.schemaVersion, 1);
    assert.ok(Array.isArray(manifest.files));
    assert.ok(manifest.name);
    assert.ok(manifest.version);
  });

  it("sha256 values match sha256sum output for known fixture bytes", () => {
    const sisyphusPath = join(tmpDir, ".opencode", "agent", "sisyphus.md");
    const expectedHash = sha256File(sisyphusPath);
    const manifest = generateManifest(tmpDir);
    const entry = manifest.files.find((f) => f.dest === "agent/sisyphus.md");
    assert.ok(entry, "sisyphus.md should be in manifest");
    assert.strictEqual(entry.sha256, expectedHash);
  });

  it("sorts files by dest (deterministic ordering)", () => {
    const manifest = generateManifest(tmpDir);
    const dests = manifest.files.map((f) => f.dest);
    const sorted = [...dests].sort();
    assert.deepStrictEqual(dests, sorted, "files should be sorted by dest");
  });

  it("rejects a payload path that escapes the root (../evil)", () => {
    const evilDir = join(tmpDir, "..", "evil-fixture");
    mkdirSync(evilDir, { recursive: true });
    writeFileSync(join(evilDir, "evil.md"), "evil");
    let threw = false;
    try {
      generateManifest(tmpDir, [join(evilDir, "evil.md")]);
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes("escape") || err.message.includes("outside"), err.message);
    }
    rmSync(evilDir, { recursive: true, force: true });
    assert.ok(threw, "should throw on escaped path");
  });

  it("rejects a plugin entry whose dist artifact is missing", () => {
    const brokenDir = join(tmpDir, "..", `broken-${Date.now()}`);
    mkdirSync(join(brokenDir, "agent"), { recursive: true });
    mkdirSync(join(brokenDir, "command"), { recursive: true });
    writeFileSync(join(brokenDir, "agent", "sisyphus.md"), "# Sisyphus\n");
    writeFileSync(join(brokenDir, "command", "plan.md"), "# Plan\n");
    // Intentionally no dist/plugin
    let threw = false;
    try {
      generateManifest(brokenDir);
    } catch (err) {
      threw = true;
    }
    rmSync(brokenDir, { recursive: true, force: true });
    assert.ok(threw, "should throw when plugin dist is missing");
  });

  it("maps .opencode/agent/** → kind=agent, dest=agent/<name>.md", () => {
    const manifest = generateManifest(tmpDir);
    const agentEntries = manifest.files.filter((f) => f.kind === "agent");
    assert.ok(agentEntries.length > 0);
    agentEntries.forEach((e) => {
      assert.ok(e.dest.startsWith("agent/"), `${e.dest} should start with agent/`);
      assert.ok(e.dest.endsWith(".md"), `${e.dest} should end with .md`);
    });
  });

  it("maps .opencode/command/** → kind=command, dest=command/<name>.md", () => {
    const manifest = generateManifest(tmpDir);
    const cmdEntries = manifest.files.filter((f) => f.kind === "command");
    assert.ok(cmdEntries.length > 0);
    cmdEntries.forEach((e) => {
      assert.ok(e.dest.startsWith("command/"), `${e.dest} should start with command/`);
      assert.ok(e.dest.endsWith(".md"), `${e.dest} should end with .md`);
    });
  });

  it("maps dist/plugin/** → kind=plugin, dest=plugin/<name>.js", () => {
    const manifest = generateManifest(tmpDir);
    const pluginEntry = manifest.files.find((f) => f.kind === "plugin");
    assert.ok(pluginEntry, "plugin entry should exist");
    assert.ok(pluginEntry.dest.startsWith("plugin/"), `${pluginEntry.dest} should start with plugin/`);
    assert.ok(pluginEntry.dest.endsWith(".js"), `${pluginEntry.dest} should end with .js`);
  });

  it("generated manifest validates against schema (round-trip)", () => {
    const manifest = generateManifest(tmpDir);
    // Validate schema structure
    assert.strictEqual(typeof manifest.schemaVersion, "number");
    assert.strictEqual(manifest.schemaVersion, 1);
    assert.strictEqual(typeof manifest.name, "string");
    assert.strictEqual(typeof manifest.version, "string");
    assert.ok(Array.isArray(manifest.files));
    manifest.files.forEach((f) => {
      assert.ok(typeof f.source === "string", "source must be string");
      assert.ok(typeof f.dest === "string", "dest must be string");
      assert.ok(typeof f.kind === "string", "kind must be string");
      assert.ok(typeof f.sha256 === "string", "sha256 must be string");
      assert.ok(/^[0-9a-f]{64}$/.test(f.sha256), "sha256 must be 64 lowercase hex");
      assert.ok(f.dest.includes("/"), "dest must be relative path with /");
    });
  });
});
