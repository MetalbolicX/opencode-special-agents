#!/usr/bin/env node
// install.mjs — Plan 005+006: zero-third-party-dependency ESM installer

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync, existsSync, readdirSync, accessSync, constants, realpathSync } from "node:fs";
import { join, resolve, relative, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const PKG_NAME = process.env.PKG_NAME || "opencode-special-agents";
const STATE_FILE = ".opencode-special-agents.json";
const STAGING_PREFIX = ".staging-";
const BACKUP_DIR = ".opencode-special-agents.backups";
const MAX_BACKUPS = 3;
const GITIGNORE_FILE = ".gitignore";
const GITIGNORE_LINE = ".opencode-special-agents.json";

const USAGE = `Usage: install.mjs [command] [options]
Install opencode-special-agents into the target directory.

Commands:
  install    Install or update (default)
  uninstall  Remove installed files (safety: report-only without state)
  update     Update to latest version (alias of install with reporting)
  status     Show installed files and their state
  doctor     Diagnose installation health

Options:
  --source <path>         Override source directory (default: walk-up from cwd)
  --root <path>           Override target root (default: <cwd>/.opencode/)
  --scope <project|global>  Installation scope (default: project)
  --plugin <on|off>       Enable/disable plugin (default: on)
  --dry-run               Show what would be installed without writing files
  --yes                   Non-interactive: keep user-modified files (default)
  --allow-self-install    Allow installing into the source's own .opencode/ dir
  --json                  JSON output (status/doctor)
  --purge                 Remove backups and staging dirs (uninstall)
  --force                 Force delete user-modified files (uninstall)
  --gitignore-state       Add state file to .opencode/.gitignore (install)
  -h, --help              Show this usage
`.trim();

// ---------------------------------------------------------------------------
// SHA-256 helpers
// ---------------------------------------------------------------------------
function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function sha256File(filePath) {
  return sha256(readFileSync(filePath));
}

// ---------------------------------------------------------------------------
// Raw argument parser
// ---------------------------------------------------------------------------
const VALID_COMMANDS = new Set(["install", "uninstall", "update", "status", "doctor", ""]);

export function parseArgs(argv) {
  const args = { raw: [], command: "install" };
  const it = argv[Symbol.iterator]();
  for (const tok of it) {
    if (tok === "--source") { args.source = it.next().value; continue; }
    if (tok === "--root") { args.root = it.next().value; continue; }
    if (tok === "--scope") { args.scope = it.next().value; continue; }
    if (tok === "--plugin") { args.plugin = it.next().value; continue; }
    if (tok === "--dry-run") { args["dry-run"] = true; continue; }
    if (tok === "--yes") { args.yes = true; continue; }
    if (tok === "--allow-self-install") { args["allow-self-install"] = true; continue; }
    if (tok === "--json") { args.json = true; continue; }
    if (tok === "--purge") { args.purge = true; continue; }
    if (tok === "--force") { args.force = true; continue; }
    if (tok === "--gitignore-state") { args["gitignore-state"] = true; continue; }
    if (tok === "-h" || tok === "--help") { args.help = true; continue; }
    if (tok.startsWith("-")) { args.raw.push(tok); continue; }
    // First non-flag token is the command
    if (!tok.startsWith("-") && args.raw.length === 0 && VALID_COMMANDS.has(tok)) {
      args.command = tok;
      continue;
    }
    args.raw.push(tok);
  }
  return args;
}

// ---------------------------------------------------------------------------
// Step 2: Source resolution
// ---------------------------------------------------------------------------
export function resolveSourceDir({ cwd, sourceArg }) {
  if (sourceArg) {
    if (!existsSync(sourceArg)) throw new Error(`Source directory not found: ${sourceArg}`);
    return resolve(sourceArg);
  }
  // Walk up from cwd
  let dir = resolve(cwd || process.cwd());
  const root = resolve("/");
  while (true) {
    const manifestPath = join(dir, "manifest.json");
    if (existsSync(manifestPath)) return dir;
    if (dir === root) break;
    const parent = resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("manifest.json not found; run 'pnpm run gen:manifest' first");
}

export function loadManifest(sourceDir) {
  const manifestPath = join(sourceDir, "manifest.json");
  if (!existsSync(manifestPath)) throw new Error("manifest.json not found");
  const raw = JSON.parse(readFileSync(manifestPath, "utf-8"));
  if (raw.schemaVersion !== 1) throw new Error(`Unsupported manifest schema version: ${raw.schemaVersion}`);
  if (!raw.name || typeof raw.name !== "string") throw new Error("manifest.json missing valid name field");
  if (!Array.isArray(raw.files)) throw new Error("manifest.json missing files array");
  for (const entry of raw.files) {
    if (!entry.source || !entry.dest || !entry.sha256 || !entry.kind) {
      throw new Error(`Malformed manifest entry: ${JSON.stringify(entry)}`);
    }
  }
  return raw;
}

export function verifyPayload(sourceDir, manifest) {
  const errors = [];
  for (const entry of manifest.files) {
    const srcPath = join(sourceDir, entry.source);
    if (!existsSync(srcPath)) {
      errors.push(`Payload file missing: ${entry.source}`);
      continue;
    }
    const actual = sha256File(srcPath);
    if (actual !== entry.sha256) {
      errors.push(`SHA256 mismatch for ${entry.source}: expected ${entry.sha256}, got ${actual}`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Payload integrity failed:\n  ${errors.join("\n  ")}`);
  }
}

export function verifyPayloadContainment(sourceDir, manifest) {
  for (const entry of manifest.files) {
    const srcPath = resolve(sourceDir, entry.source);
    if (!srcPath.startsWith(resolve(sourceDir))) {
      throw new Error(`Payload path escapes source root: ${entry.source}`);
    }
  }
}

export function validateManifestIdentity(manifest, expectedName) {
  if (manifest.name !== expectedName) {
    throw new Error(`Foreign manifest: expected "${expectedName}", got "${manifest.name}"`);
  }
}

// ---------------------------------------------------------------------------
// Step 3: Target resolution
// ---------------------------------------------------------------------------
export function resolveTargetDir({ scope, rootArg, cwd, env, home }) {
  if (rootArg) return ensureTrailingSlash(resolve(rootArg));

  if (scope === "global") {
    const configDir = env?.OPENCODE_CONFIG_DIR || "";
    if (configDir) return ensureTrailingSlash(resolve(configDir));
    const h = home || env?.HOME || "/home";
    return ensureTrailingSlash(join(h, ".config", "opencode"));
  }

  // Default: project scope
  return ensureTrailingSlash(join(cwd || process.cwd(), ".opencode"));
}

function ensureTrailingSlash(p) {
  return p.endsWith("/") ? p : p + "/";
}

// ---------------------------------------------------------------------------
// Step 4: Install plan (pure functions)
// ---------------------------------------------------------------------------
export function planInstall(manifest, existingFiles, { plugin: pluginEnabled = true } = {}) {
  const result = [];
  const existingMap = new Map(existingFiles.map((f) => [f.dest, f]));

  for (const entry of manifest.files) {
    if (entry.kind === "plugin" && !pluginEnabled) continue;

    const existing = existingMap.get(entry.dest);
    if (!existing) {
      result.push({ ...entry, disposition: "create" });
    } else if (existing.sha256 === entry.sha256) {
      result.push({ ...entry, disposition: "unchanged", existingSha: existing.sha256 });
    } else {
      result.push({ ...entry, disposition: "conflict", existingSha: existing.sha256 });
    }
  }
  return result;
}

// Detect file-level conflicts by comparing current disk SHA vs manifest SHA and state SHA
// Detect file-level conflicts: file on disk differs from manifest AND from state
// (user modified a tracked file after install)
export function detectFileConflict(entry, targetDir, stateSha) {
  const targetPath = join(targetDir, entry.dest);
  if (!existsSync(targetPath)) return null;
  const diskSha = sha256File(targetPath);
  if (diskSha === entry.sha256) return null; // disk matches manifest
  if (stateSha !== undefined && diskSha === stateSha) return null; // disk matches state (reverted)
  return { disposition: "conflict", diskSha };
}

export function resolveConflict(disposition, { yes, tty }) {
  if (disposition !== "conflict") return disposition;
  if (yes || !tty) return "keep";

  // Interactive TTY: return a prompt function
  return function promptUser(rl) {
    return new Promise((resolve) => {
      const q = `File conflict detected. Overwrite, keep (k), or diff (d)? [k] `;
      if (rl) {
        rl.question(q, (answer) => {
          const a = answer.trim().toLowerCase();
          if (a === "overwrite" || a === "o") resolve("overwrite");
          else if (a === "diff" || a === "d") resolve("diff");
          else resolve("keep");
        });
      } else {
        resolve("keep");
      }
    });
  };
}

// ---------------------------------------------------------------------------
// Step 5: Transaction apply
// ---------------------------------------------------------------------------
export async function applyInstall({ plan, targetDir, sourceDir, dryRun = false, yes = false, tty = false }) {
  if (dryRun) {
    console.log("Dry-run: install plan");
    for (const p of plan) {
      console.log(`  ${p.disposition}: ${p.dest}`);
    }
    return { status: "dry-run" };
  }

  const stagingDir = join(dirname(targetDir), `${STAGING_PREFIX}${String(process.pid)}`);
  const backupDir = join(targetDir, BACKUP_DIR);

  try {
    // Clean stale staging dirs from previous crashed runs
    cleanStaleStaging(dirname(targetDir));

    // Stage: copy all planned files into staging
    mkdirSync(stagingDir, { recursive: true });
    for (const p of plan) {
      if (p.disposition === "unchanged") continue;
      const destRel = p.dest;
      const destDir = join(stagingDir, dirname(destRel));
      if (destDir !== stagingDir) mkdirSync(destDir, { recursive: true });
      const srcPath = join(sourceDir, p.source);
      copyFileSync(srcPath, join(stagingDir, destRel));
    }

    // Validate staged files
    for (const p of plan) {
      if (p.disposition === "unchanged") continue;
      const stagedPath = join(stagingDir, p.dest);
      if (!existsSync(stagedPath)) throw new Error(`Staged file missing: ${p.dest}`);
      const actual = sha256File(stagedPath);
      if (actual !== p.sha256) throw new Error(`SHA256 mismatch after staging: ${p.dest}`);
    }

    // Apply: resolve conflicts and promote
    for (const p of plan) {
      const targetPath = join(targetDir, p.dest);
      const targetExists = existsSync(targetPath);

      // Detect disk conflict: file on disk differs from manifest AND from state
      // (user modified tracked file after install)
      let disposition = p.disposition;
      let isUserConflict = false;
      if (targetExists) {
        const diskSha = sha256File(targetPath);
        const manifestSha = p.sha256;
        const stateSha = p.existingSha;
        // File modified by user: disk differs from manifest AND (no state entry or differs from state)
        if (diskSha !== manifestSha && (stateSha === undefined || diskSha !== stateSha)) {
          disposition = "conflict";
          isUserConflict = true;
        }
      }

      // Skip unchanged (disk matches manifest, already correct — no action needed)
      // But if a user conflict was detected, upgrade to conflict for proper resolution
      if (disposition === "unchanged" && !isUserConflict) continue;
      if (disposition === "unchanged" && isUserConflict) {
        // User modified an unchanged file — upgrade to conflict for resolution
        disposition = "conflict";
      }

      const resolvedDisposition = disposition === "conflict"
        ? resolveConflict(disposition, { yes, tty })
        : disposition;

      if (resolvedDisposition === "keep") {
        if (disposition === "conflict") {
          if (!isUserConflict) {
            // Version-only conflict: disk matches state (not user-modified),
            // but manifest changed. Proceed with update.
            mkdirSync(dirname(targetPath), { recursive: true });
            // Copy from staging (was staged as conflict) or from source
            const stagedPath = join(stagingDir, p.dest);
            if (existsSync(stagedPath)) {
              copyFileSync(stagedPath, targetPath);
            } else {
              copyFileSync(join(sourceDir, p.source), targetPath);
            }
            p.disposition = "updated";
          } else {
            // Genuine user conflict: keep the user's version
            p.disposition = "kept";
            p.isUserConflict = true;
          }
        }
        continue;
      }

      if (resolvedDisposition === "overwrite" || resolvedDisposition === "create") {
        // Backup if overwriting a user-modified file
        if (targetExists && disposition === "conflict") {
          doBackup(targetPath, backupDir);
        }
        // Ensure target dir exists
        mkdirSync(dirname(targetPath), { recursive: true });
        // Promote from staging
        copyFileSync(join(stagingDir, p.dest), targetPath);
        // Update plan disposition for state file accuracy
        p.disposition = targetExists ? "overwritten" : "created";
      }
    }

    // Write state file LAST
    writeStateFile(targetDir, plan);
  } finally {
    // Always clean up staging
    if (existsSync(stagingDir)) {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  }
}

function cleanStaleStaging(parentDir) {
  if (!existsSync(parentDir)) return;
  for (const entry of readdirSync(parentDir)) {
    if (entry.startsWith(STAGING_PREFIX)) {
      rmSync(join(parentDir, entry), { recursive: true, force: true });
    }
  }
}

function doBackup(targetPath, backupDir) {
  mkdirSync(backupDir, { recursive: true });
  const name = targetPath.replace(/^.*\//, "");
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = join(backupDir, `${name}.bak.${ts}`);
  copyFileSync(targetPath, backupPath);
  // Rotate: keep at most MAX_BACKUPS
  const backups = readdirSync(backupDir)
    .filter((f) => f.startsWith(name + ".bak."))
    .sort()
    .reverse();
  for (const old of backups.slice(MAX_BACKUPS)) {
    rmSync(join(backupDir, old), { force: true });
  }
}

function writeStateFile(targetDir, plan) {
  const manifest = plan._manifest || {};
  const state = {
    schemaVersion: 1,
    name: manifest.name || PKG_NAME,
    version: manifest.version || "0.0.0",
    scope: plan._scope || "project",
    target: isAbsolute(targetDir) ? targetDir : resolve(targetDir),
    installedAt: new Date().toISOString(),
    pluginEnabled: plan._pluginEnabled !== false,
    files: plan.map((p) => ({
      dest: p.dest,
      sha256: p.sha256,
      disposition: p.disposition,
    })),
  };
  writeFileSync(join(targetDir, STATE_FILE), JSON.stringify(state, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Step 6: Unified diff helper
// ---------------------------------------------------------------------------
export function unifiedDiff(oldLines, newLines, { context = 3 } = {}) {
  if (oldLines.join("\n") === newLines.join("\n")) return "";
  const result = [];
  const oldSet = new Set(oldLines);
  const newSet = new Set(newLines);
  const removed = oldLines.filter((l) => !newSet.has(l));
  const added = newLines.filter((l) => !oldSet.has(l));
  if (removed.length === 0 && added.length === 0) return "";
  for (const l of removed) result.push(`-${l}`);
  for (const l of added) result.push(`+${l}`);
  return result.join("\n");
}

// ---------------------------------------------------------------------------
// Step 7: Self-install guard
// ---------------------------------------------------------------------------
export function detectSelfInstall({ sourceDir, targetDir }) {
  const sourceOpencode = resolve(sourceDir, ".opencode");
  const normalizedTarget = resolve(targetDir);
  if (normalizedTarget === sourceOpencode || normalizedTarget === resolve(sourceDir)) {
    throw new Error(
      "Self-install detected: target is the source's own .opencode/ directory.\n" +
      "Pass --allow-self-install to proceed anyway."
    );
  }
}

// ---------------------------------------------------------------------------
// Step 8: Full install orchestration
// ---------------------------------------------------------------------------
export async function runInstall(argv) {
  const args = parseArgs(argv);
  const cwd = process.cwd();

  // Unknown command — must check before manifest validation
  if (args.raw.length > 0) {
    console.error(`Unknown command: ${args.raw[0]}`);
    console.error(USAGE);
    return { status: 2 };
  }

  // Help or no args at all — just print usage, no manifest needed
  if (args.help || (
    !args.source && !args.root && !args.scope &&
    !args.plugin && !args["dry-run"] && !args.yes && !args["allow-self-install"]
  )) {
    console.log(USAGE);
    return { status: 0 };
  }

  const dryRun = !!args["dry-run"];
  const yes = !!args.yes;
  const tty = !!process.stdout.isTTY;

  // Source resolution
  let sourceDir;
  try {
    sourceDir = resolveSourceDir({ cwd, sourceArg: args.source });
  } catch (err) {
    console.error(`Source resolution error: ${err.message}`);
    return { status: 2 };
  }

  // Load manifest
  let manifest;
  try {
    manifest = loadManifest(sourceDir);
    verifyPayloadContainment(sourceDir, manifest);
    verifyPayload(sourceDir, manifest);
  } catch (err) {
    console.error(`Manifest error: ${err.message}`);
    return { status: 2 };
  }

  // Identity check (after manifest load + validation, before any writes)
  try {
    validateManifestIdentity(manifest, PKG_NAME);
  } catch (err) {
    console.error(`Manifest error: ${err.message}`);
    return { status: 2 };
  }

  // Target resolution
  const targetDir = resolveTargetDir({
    scope: args.scope || "project",
    rootArg: args.root,
    cwd,
    env: process.env,
    home: process.env.HOME,
  });

  // Self-install guard — skip in dry-run (no actual writes)
  if (!args["allow-self-install"] && !dryRun) {
    try {
      detectSelfInstall({ sourceDir, targetDir });
    } catch (err) {
      console.error(`Self-install guard: ${err.message}`);
      return { status: 2 };
    }
  }

  // Load existing state
  const stateFilePath = join(targetDir, STATE_FILE);
  let existingFiles = [];
  if (existsSync(stateFilePath)) {
    try {
      const existingState = JSON.parse(readFileSync(stateFilePath, "utf-8"));
      existingFiles = existingState.files || [];
    } catch {
      // Corrupt state: treat as not installed
    }
  }

  // Plan install
  const pluginEnabled = args.plugin !== "off";
  const plan = planInstall(manifest, existingFiles, { plugin: pluginEnabled });
  plan._manifest = manifest;
  plan._scope = args.scope || "project";
  plan._pluginEnabled = pluginEnabled;

  // Conflict resolution in interactive mode
  if (!yes && tty) {
    for (const p of plan) {
      if (p.disposition === "conflict") {
        const action = await resolveConflict(p.disposition, { yes, tty })(null);
        if (action === "diff") {
          // Show diff
          const targetPath = join(targetDir, p.dest);
          if (existsSync(targetPath)) {
            const oldContent = readFileSync(targetPath, "utf-8").split("\n");
            const newContent = readFileSync(join(sourceDir, p.source), "utf-8").split("\n");
            console.log(unifiedDiff(oldContent, newContent, { context: 3 }));
          }
        }
        p.resolvedDisposition = action;
      }
    }
  }

  // Ensure target dir
  if (!dryRun) mkdirSync(targetDir, { recursive: true });

  // --gitignore-state: add state file to .opencode/.gitignore before state write
  if (!dryRun && args["gitignore-state"]) {
    if (args.scope === "global") {
      console.error("--gitignore-state is only supported for project scope.");
      return { status: 2 };
    }
    try {
      gitignoreState(targetDir);
    } catch (err) {
      console.error(`gitignore-state error: ${err.message}`);
      return { status: 1 };
    }
  }

  // Apply
  try {
    await applyInstall({ plan, targetDir, sourceDir, dryRun, yes, tty });
  } catch (err) {
    console.error(`Install error: ${err.message}`);
    return { status: 1 };
  }

  // Print warnings for kept user-modified files
  for (const p of plan) {
    if (p.isUserConflict && (p.disposition === "kept" || p.disposition === "conflict")) {
      console.log(`KEPT (user-modified): ${p.dest}`);
    }
  }

  if (dryRun) {
    console.log("Dry-run complete — no files written.");
  }

  return { status: 0 };
}

// ---------------------------------------------------------------------------
// Helper: check if target dir is writable
// ---------------------------------------------------------------------------
function isTargetWritable(targetDir) {
  try {
    accessSync(targetDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Helper: check if target dir exists and is writable (for doctor)
// ---------------------------------------------------------------------------
function canWriteTarget(targetDir) {
  try {
    if (!existsSync(targetDir)) {
      // Check if parent is writable
      const parent = dirname(targetDir);
      accessSync(parent, constants.W_OK);
      return true;
    }
    accessSync(targetDir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// runStatus: show installed files and their state
// ---------------------------------------------------------------------------
export async function runStatus(argv) {
  const args = parseArgs(argv);
  const cwd = process.cwd();

  if (args.help) {
    console.log(`Usage: install.mjs status [options]
Show installation status.

Options:
  --root <path>           Override target root
  --json                  JSON output (schema v1)
  -h, --help              Show this usage
`);
    return { status: 0 };
  }

  const targetDir = resolveTargetDir({
    scope: args.scope || "project",
    rootArg: args.root,
    cwd,
    env: process.env,
    home: process.env.HOME,
  });

  const stateFilePath = join(targetDir, STATE_FILE);
  let state = null;
  let manifest = null;
  let sourceDir = null;

  // Try to load state
  if (existsSync(stateFilePath)) {
    try {
      state = JSON.parse(readFileSync(stateFilePath, "utf-8"));
    } catch {
      // Corrupt state — will be reported in diagnostics
    }
  }

  // Try to load manifest for version info
  try {
    sourceDir = resolveSourceDir({ cwd, sourceArg: args.source });
    manifest = loadManifest(sourceDir);
  } catch {
    // No manifest available
  }

  // Build file list with states
  const files = [];
  const diagnostics = [];

  if (state && Array.isArray(state.files)) {
    for (const f of state.files) {
      const targetPath = join(targetDir, f.dest);
      let fileState = "installed";
      if (!existsSync(targetPath)) {
        fileState = "missing";
      } else {
        const diskSha = sha256File(targetPath);
        if (diskSha !== f.sha256) {
          fileState = "modified";
        }
      }
      files.push({ dest: f.dest, state: fileState });
    }
  } else if (manifest && Array.isArray(manifest.files)) {
    // No state but manifest available — report what's in target
    for (const f of manifest.files) {
      const targetPath = join(targetDir, f.dest);
      if (!existsSync(targetPath)) {
        files.push({ dest: f.dest, state: "missing" });
      } else {
        const diskSha = sha256File(targetPath);
        if (diskSha !== f.sha256) {
          files.push({ dest: f.dest, state: "modified" });
        } else {
          files.push({ dest: f.dest, state: "installed" });
        }
      }
    }
  }

  // Determine result
  let result = "ok";
  if (files.some(f => f.state === "missing" || f.state === "modified")) {
    result = "degraded";
  }
  if (files.length === 0 && !state) {
    result = "failed";
    diagnostics.push({ level: "warn", code: "NO_STATE", message: "No installation state found. Run install first." });
  }

  if (args.json) {
    const output = {
      schemaVersion: 1,
      command: "status",
      target: targetDir,
      scope: state?.scope || args.scope || "project",
      version: {
        manifest: manifest?.version || null,
        installed: state?.version || null,
      },
      pluginEnabled: state?.pluginEnabled ?? true,
      files,
      diagnostics,
      result,
    };
    console.log(JSON.stringify(output));
    return { status: 0 };
  }

  // Text mode
  const scope = state?.scope || args.scope || "project";
  const installedVersion = state?.version || "none";
  const manifestVersion = manifest?.version || "unknown";
  console.log(`Target: ${targetDir}`);
  console.log(`Scope: ${scope}`);
  console.log(`Manifest version: ${manifestVersion}`);
  console.log(`Installed version: ${installedVersion}`);
  console.log(`Plugin: ${state?.pluginEnabled !== false ? "enabled" : "disabled"}`);
  console.log("");
  console.log("Files:");
  for (const f of files) {
    const marker = f.state === "installed" ? "✓" : f.state === "missing" ? "✗" : f.state === "modified" ? "~" : "⊗";
    console.log(`  ${marker} ${f.dest}: ${f.state}`);
  }
  if (files.length === 0) {
    console.log("  (no files tracked)");
  }
  console.log("");
  console.log(`Result: ${result}`);

  return { status: 0 };
}

// ---------------------------------------------------------------------------
// runDoctor: diagnose installation health
// ---------------------------------------------------------------------------
export async function runDoctor(argv) {
  const args = parseArgs(argv);
  const cwd = process.cwd();

  if (args.help) {
    console.log(`Usage: install.mjs doctor [options]
Diagnose installation health.

Options:
  --root <path>           Override target root
  --source <path>         Override source directory
  --json                  JSON output (schema v1)
  -h, --help              Show this usage
`);
    return { status: 0 };
  }

  const targetDir = resolveTargetDir({
    scope: args.scope || "project",
    rootArg: args.root,
    cwd,
    env: process.env,
    home: process.env.HOME,
  });

  const stateFilePath = join(targetDir, STATE_FILE);
  let state = null;
  let manifest = null;
  let sourceDir = null;
  const diagnostics = [];
  let exitCode = 0;

  // Try to load state
  if (existsSync(stateFilePath)) {
    try {
      state = JSON.parse(readFileSync(stateFilePath, "utf-8"));
    } catch {
      diagnostics.push({ level: "error", code: "STATE_CORRUPT", message: "State file is corrupt or invalid JSON." });
      exitCode = 1;
    }
  }

  // Try to load manifest
  try {
    sourceDir = resolveSourceDir({ cwd, sourceArg: args.source });
    manifest = loadManifest(sourceDir);
  } catch (err) {
    diagnostics.push({ level: "error", code: "PAYLOAD_INVALID", message: `Cannot load manifest: ${err.message}. Rebuild with 'pnpm run build && pnpm run gen:manifest'.` });
    exitCode = 2;
  }

  // Verify payload integrity
  if (manifest && sourceDir) {
    try {
      verifyPayload(sourceDir, manifest);
    } catch (err) {
      diagnostics.push({ level: "error", code: "PAYLOAD_INVALID", message: `Payload integrity failed: ${err.message}` });
      exitCode = 2;
    }
  }

  // Check target writability
  if (!canWriteTarget(targetDir)) {
    diagnostics.push({ level: "error", code: "TARGET_UNWRITABLE", message: `Target directory is not writable: ${targetDir}` });
    exitCode = 2;
  }

  // Build file list and check for drift
  const files = [];
  let hasDrift = false;

  if (state && Array.isArray(state.files)) {
    for (const f of state.files) {
      const targetPath = join(targetDir, f.dest);
      let fileState = "installed";
      if (!existsSync(targetPath)) {
        fileState = "missing";
        hasDrift = true;
      } else {
        const diskSha = sha256File(targetPath);
        if (diskSha !== f.sha256) {
          fileState = "modified";
          hasDrift = true;
        }
      }
      files.push({ dest: f.dest, state: fileState });
    }
  } else if (manifest && Array.isArray(manifest.files)) {
    for (const f of manifest.files) {
      const targetPath = join(targetDir, f.dest);
      if (!existsSync(targetPath)) {
        files.push({ dest: f.dest, state: "missing" });
      } else {
        const diskSha = sha256File(targetPath);
        if (diskSha !== f.sha256) {
          files.push({ dest: f.dest, state: "modified" });
          hasDrift = true;
        } else {
          files.push({ dest: f.dest, state: "installed" });
        }
      }
    }
  }

  if (hasDrift && exitCode < 1) {
    diagnostics.push({ level: "warn", code: "FILE_DRIFT", message: "One or more installed files have been modified." });
    exitCode = 1;
  }

  // Determine result
  let result = "ok";
  if (exitCode === 1) result = "degraded";
  if (exitCode === 2) result = "failed";

  if (args.json) {
    const output = {
      schemaVersion: 1,
      command: "doctor",
      target: targetDir,
      scope: state?.scope || args.scope || "project",
      version: {
        manifest: manifest?.version || null,
        installed: state?.version || null,
      },
      pluginEnabled: state?.pluginEnabled ?? true,
      files,
      diagnostics,
      result,
    };
    console.log(JSON.stringify(output));
    return { status: exitCode };
  }

  // Text mode
  console.log(`Target: ${targetDir}`);
  console.log(`Scope: ${state?.scope || args.scope || "project"}`);
  console.log(`Result: ${result}`);
  console.log("");
  if (diagnostics.length === 0) {
    console.log("No issues found.");
  } else {
    console.log("Diagnostics:");
    for (const d of diagnostics) {
      const icon = d.level === "error" ? "✗" : d.level === "warn" ? "~" : "ℹ";
      console.log(`  ${icon} [${d.code}] ${d.message}`);
    }
  }

  return { status: exitCode };
}

// ---------------------------------------------------------------------------
// runUninstall: remove installed files (safety: report-only without state)
// ---------------------------------------------------------------------------
export async function runUninstall(argv) {
  const args = parseArgs(argv);
  const cwd = process.cwd();

  if (args.help) {
    console.log(`Usage: install.mjs uninstall [options]
Remove installed files (safety: report-only without valid state).

Options:
  --root <path>           Override target root
  --purge                 Also remove backups and staging dirs
  --force                 Force delete user-modified files (with backup)
  -h, --help              Show this usage
`);
    return { status: 0 };
  }

  const targetDir = resolveTargetDir({
    scope: args.scope || "project",
    rootArg: args.root,
    cwd,
    env: process.env,
    home: process.env.HOME,
  });

  const stateFilePath = join(targetDir, STATE_FILE);

  // Report-only if no valid state
  if (!existsSync(stateFilePath)) {
    console.log("No installation state found.");
    console.log("Cannot uninstall: state file is missing.");
    console.log("To recover: run install first, then uninstall.");
    return { status: 1 };
  }

  let state = null;
  try {
    state = JSON.parse(readFileSync(stateFilePath, "utf-8"));
  } catch {
    console.log("State file is corrupt or invalid JSON.");
    console.log("Cannot uninstall safely without valid state.");
    console.log("To recover: run install first, then uninstall.");
    return { status: 1 };
  }

  if (!state || !Array.isArray(state.files)) {
    console.log("State file is missing expected fields.");
    console.log("Cannot uninstall safely without valid state.");
    console.log("To recover: run install first, then uninstall.");
    return { status: 1 };
  }

  // Report-only if --force but no valid state (absolute contract)
  if (args.force && !state) {
    console.log("No valid state — report-only mode is absolute even with --force.");
    console.log("Cannot uninstall safely without valid state.");
    return { status: 1 };
  }

  // Process files
  let hadConflicts = false;
  const backupDir = join(targetDir, BACKUP_DIR);

  for (const f of state.files) {
    const targetPath = join(targetDir, f.dest);
    if (!existsSync(targetPath)) continue; // Already gone

    const diskSha = sha256File(targetPath);
    if (diskSha !== f.sha256) {
      // User modified this file
      if (args.force) {
        // Backup then delete
        doBackup(targetPath, backupDir);
        rmSync(targetPath, { force: true });
        console.log(`DELETED (force): ${f.dest}`);
      } else {
        // Keep it, warn
        console.log(`KEPT (user-modified): ${f.dest}`);
        hadConflicts = true;
      }
    } else {
      // Installer-proven file — safe to delete
      rmSync(targetPath, { force: true });
      console.log(`Removed: ${f.dest}`);
    }
  }

  // Prune empty directories under agent/, command/, plugin/
  for (const sub of ["agent", "command", "plugin"]) {
    const subDir = join(targetDir, sub);
    if (existsSync(subDir)) {
      try {
        const entries = readdirSync(subDir);
        if (entries.length === 0) {
          rmSync(subDir, { recursive: true, force: true });
        }
      } catch {
        // Ignore
      }
    }
  }

  // Delete state file
  rmSync(stateFilePath, { force: true });
  console.log("State file removed.");

  // Purge backups and staging if requested
  if (args.purge) {
    if (existsSync(backupDir)) {
      rmSync(backupDir, { recursive: true, force: true });
      console.log("Backup directory purged.");
    }
    // Clean any stale staging dirs in target's parent
    const targetParent = dirname(targetDir);
    if (existsSync(targetParent)) {
      for (const entry of readdirSync(targetParent)) {
        if (entry.startsWith(STAGING_PREFIX)) {
          rmSync(join(targetParent, entry), { recursive: true, force: true });
          console.log(`Staging dir purged: ${entry}`);
        }
      }
    }
  }

  return { status: hadConflicts ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// runUpdate: hash-based reinstall with per-file reporting
// ---------------------------------------------------------------------------
export async function runUpdate(argv) {
  const args = parseArgs(argv);
  const cwd = process.cwd();

  if (args.help) {
    console.log(`Usage: install.mjs update [options]
Update to the latest version (hash-based, per-file reporting).

Options:
  --source <path>         Override source directory
  --root <path>           Override target root
  --yes                   Keep user-modified files (non-interactive)
  --json                  JSON output
  -h, --help              Show this usage
`);
    return { status: 0 };
  }

  // Run install but capture and report per-file dispositions
  const dryRun = !!args["dry-run"];
  const yes = !!args.yes;
  const tty = !!process.stdout.isTTY;

  // Source resolution
  let sourceDir;
  try {
    sourceDir = resolveSourceDir({ cwd, sourceArg: args.source });
  } catch (err) {
    console.error(`Source resolution error: ${err.message}`);
    return { status: 2 };
  }

  // Load manifest
  let manifest;
  try {
    manifest = loadManifest(sourceDir);
    verifyPayloadContainment(sourceDir, manifest);
    verifyPayload(sourceDir, manifest);
  } catch (err) {
    console.error(`Manifest error: ${err.message}`);
    return { status: 2 };
  }

  try {
    validateManifestIdentity(manifest, PKG_NAME);
  } catch (err) {
    console.error(`Manifest error: ${err.message}`);
    return { status: 2 };
  }

  // Target resolution
  const targetDir = resolveTargetDir({
    scope: args.scope || "project",
    rootArg: args.root,
    cwd,
    env: process.env,
    home: process.env.HOME,
  });

  // Self-install guard
  if (!args["allow-self-install"] && !dryRun) {
    try {
      detectSelfInstall({ sourceDir, targetDir });
    } catch (err) {
      console.error(`Self-install guard: ${err.message}`);
      return { status: 2 };
    }
  }

  // Load existing state
  const stateFilePath = join(targetDir, STATE_FILE);
  let existingFiles = [];
  if (existsSync(stateFilePath)) {
    try {
      const existingState = JSON.parse(readFileSync(stateFilePath, "utf-8"));
      existingFiles = existingState.files || [];
    } catch {
      // Corrupt state: treat as not installed
    }
  }

  // Plan install
  const pluginEnabled = args.plugin !== "off";
  const plan = planInstall(manifest, existingFiles, { plugin: pluginEnabled });
  plan._manifest = manifest;
  plan._scope = args.scope || "project";
  plan._pluginEnabled = pluginEnabled;

  // Ensure target dir
  if (!dryRun) mkdirSync(targetDir, { recursive: true });

  // Apply install (reuse pipeline)
  let installResult = { status: 0 };
  try {
    await applyInstall({ plan, targetDir, sourceDir, dryRun, yes, tty });
  } catch (err) {
    console.error(`Install error: ${err.message}`);
    return { status: 1 };
  }

  // Report per-file dispositions
  let hadKeptConflicts = false;
  for (const p of plan) {
    if (p.disposition === "updated" || p.disposition === "overwritten" || p.disposition === "created") {
      console.log(`updated: ${p.dest}`);
    } else if (p.disposition === "unchanged") {
      console.log(`unchanged: ${p.dest}`);
    } else if (p.disposition === "kept" || p.isUserConflict) {
      console.log(`kept: ${p.dest}`);
      hadKeptConflicts = true;
    }
  }

  if (dryRun) {
    console.log("Dry-run complete — no files written.");
  }

  return { status: hadKeptConflicts ? 1 : 0 };
}

// ---------------------------------------------------------------------------
// gitignoreState: add state file to .opencode/.gitignore
// ---------------------------------------------------------------------------
export function gitignoreState(targetDir) {
  // State file lives at targetDir/.opencode-special-agents.json
  // The gitignore for it lives at targetDir/.opencode/.gitignore (project root)
  const opencodeDir = join(targetDir, ".opencode");
  mkdirSync(opencodeDir, { recursive: true });
  const gitignorePath = join(opencodeDir, GITIGNORE_FILE);
  let content = "";
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, "utf-8");
  }
  const lines = content.split("\n");
  if (lines.includes(GITIGNORE_LINE)) {
    return; // Already present, idempotent
  }
  const newContent = content.endsWith("\n") ? content + GITIGNORE_LINE + "\n" : content + "\n" + GITIGNORE_LINE + "\n";
  writeFileSync(gitignorePath, newContent);
}

// ---------------------------------------------------------------------------
// Main guard
// ---------------------------------------------------------------------------
function isMainEntry() {
  if (!process.argv[1]) return false;
  try {
    const argUrl = pathToFileURL(realpathSync(process.argv[1])).href;
    const modUrl = pathToFileURL(realpathSync(fileURLToPath(import.meta.url))).href;
    return argUrl === modUrl;
  } catch {
    return false;
  }
}
if (isMainEntry()) {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  // Strip command token from argv before passing to sub-commands
  const cmd = args.command;
  const cmdArgv = cmd && cmd !== "install"
    ? [cmd, ...argv.filter(a => a !== cmd)]
    : argv;

  let runPromise;
  switch (cmd) {
    case "uninstall":
      runPromise = runUninstall(cmdArgv);
      break;
    case "update":
      runPromise = runUpdate(cmdArgv);
      break;
    case "status":
      runPromise = runStatus(cmdArgv);
      break;
    case "doctor":
      runPromise = runDoctor(cmdArgv);
      break;
    case "install":
    default:
      runPromise = runInstall(argv);
      break;
  }

  runPromise.then((result) => {
    process.exit(result.status);
  });
}

// ---------------------------------------------------------------------------
// Standalone exports for testing
// ---------------------------------------------------------------------------
// runInstall, runUninstall, runUpdate, runStatus, runDoctor are already exported
