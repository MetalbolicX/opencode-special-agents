import { createRequire } from "module";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

// dynamic import of the dist artifact
const mod = await import(resolve(projectRoot, "dist/plugin/continuation-enforcer.js"));

if (typeof mod.default !== "object" || mod.default === null || typeof mod.default.event !== "function") {
  console.error("FAIL: default export is not a valid plugin object");
  process.exit(1);
}

console.log("SMOKE OK");
