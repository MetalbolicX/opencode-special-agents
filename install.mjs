#!/usr/bin/env node
// install.mjs — Plan 005: zero-third-party-dependency ESM installer

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync, statSync, existsSync, readdirSync } from "node:fs";
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

const USAGE = `Usage: install.mjs [options]
Install opencode-special-agents into the target directory.

Options:
  --source <path>     Override source directory (default: walk-up from cwd)
  --root <path>       Override target root (default: <cwd>/.opencode/)
  --scope <project|global>  Installation scope (default: project)
  --plugin <on|off>   Enable/disable plugin (default: on)
  --dry-run           Show what would be installed without writing files
  --yes               Non-interactive: keep user-modified files (default)
  --allow-self-install  Allow installing into the source's own .opencode/ dir
  -h, --help          Show this usage
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
export function parseArgs(argv) {
  const args = { raw: [] };
  const it = argv[Symbol.iterator]();
  for (const tok of it) {
    if (tok === "--source") { args.source = it.next().value; continue; }
    if (tok === "--root") { args.root = it.next().value; continue; }
    if (tok === "--scope") { args.scope = it.next().value; continue; }
    if (tok === "--plugin") { args.plugin = it.next().value; continue; }
    if (tok === "--dry-run") { args["dry-run"] = true; continue; }
    if (tok === "--yes") { args.yes = true; continue; }
    if (tok === "--allow-self-install") { args["allow-self-install"] = true; continue; }
    if (tok === "-h" || tok === "--help") { args.help = true; continue; }
    if (tok.startsWith("-")) { args.raw.push(tok); continue; }
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
        // Don't overwrite; keep existing
        if (disposition === "conflict") {
          p.disposition = "kept";
          p.isUserConflict = isUserConflict;
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
// Main guard
// ---------------------------------------------------------------------------
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  runInstall(process.argv.slice(2)).then((result) => {
    process.exit(result.status);
  });
}
