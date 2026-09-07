import { readFileSync, readdirSync, statSync, writeFileSync } from "fs";
import { join, resolve, relative, dirname } from "path";
import { fileURLToPath } from "url";
import { createHash } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// SHA-256 helper
// ---------------------------------------------------------------------------
const sha256File = (filePath) => {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------------------
// Safe path validation: ensure a resolved path stays within root
// ---------------------------------------------------------------------------
const assertWithinRoot = (resolvedPath, rootPath, displayName) => {
  const normalized = resolve(resolvedPath);
  const root = resolve(rootPath);
  if (!normalized.startsWith(root)) {
    throw new Error(`Path ${displayName} (${normalized}) escapes root (${root})`);
  }
}

// ---------------------------------------------------------------------------
// Walk a directory recursively
// ---------------------------------------------------------------------------
const walkDir = (dir, root, entries = []) => {
  const items = readdirSync(dir);
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      walkDir(fullPath, root, entries);
    } else {
      entries.push({ fullPath, relative: relative(root, fullPath) });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Generate manifest
// ---------------------------------------------------------------------------
/**
 * @param {string} sourceDir - Root directory (typically repo root)
 * @param {string[]} [extraPaths] - Optional extra file paths to include
 * @returns {Manifest}
 */
export const generateManifest = (sourceDir, extraPaths = []) => {
  const root = resolve(sourceDir);
  const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

  const files = [];

  // Agent files: .opencode/agent/**/*.md → agent/<name>.md
  const agentDir = join(root, ".opencode", "agent");
  if (statSync(agentDir).isDirectory()) {
    const agentFiles = walkDir(agentDir, agentDir);
    for (const { fullPath, relative: relPath } of agentFiles) {
      if (!relPath.endsWith(".md")) continue;
      const name = relPath.replace(/\.md$/, "");
      files.push({
        source: `.opencode/agent/${relPath}`,
        dest: `agent/${name}.md`,
        kind: "agent",
        sha256: sha256File(fullPath),
      });
    }
  }

  // Command files: .opencode/command/**/*.md → command/<name>.md
  const commandDir = join(root, ".opencode", "command");
  if (statSync(commandDir).isDirectory()) {
    const commandFiles = walkDir(commandDir, commandDir);
    for (const { fullPath, relative: relPath } of commandFiles) {
      if (!relPath.endsWith(".md")) continue;
      const name = relPath.replace(/\.md$/, "");
      files.push({
        source: `.opencode/command/${relPath}`,
        dest: `command/${name}.md`,
        kind: "command",
        sha256: sha256File(fullPath),
      });
    }
  }

  // Plugin dist: dist/plugin/*.js → plugin/<name>.js
  const pluginDistDir = join(root, "dist", "plugin");
  if (statSync(pluginDistDir).isDirectory()) {
    const distFiles = readdirSync(pluginDistDir);
    for (const file of distFiles) {
      if (!file.endsWith(".js")) continue;
      const fullPath = join(pluginDistDir, file);
      const name = file.replace(/\.js$/, "");
      files.push({
        source: `dist/plugin/${file}`,
        dest: `plugin/${name}.js`,
        kind: "plugin",
        sha256: sha256File(fullPath),
      });
    }
  }

  // Validate extra paths are within root
  for (const extraPath of extraPaths) {
    const resolved = resolve(extraPath);
    assertWithinRoot(resolved, root, extraPath);
  }

  // Sort by dest for deterministic output
  files.sort((a, b) => a.dest.localeCompare(b.dest));

  return {
    name: packageJson.name,
    version: packageJson.version,
    schemaVersion: 1,
    files,
  };
}

// ---------------------------------------------------------------------------
// Main: generate and write manifest.json
// ---------------------------------------------------------------------------
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolve(__dirname, "..");
  const manifest = generateManifest(root);
  writeFileSync(join(root, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  console.log(`manifest.json written: ${manifest.files.length} entries`);
}
