import { defineConfig } from "rolldown";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  input: resolve(__dirname, ".opencode/plugin/continuation-enforcer.ts"),
  output: {
    file: resolve(__dirname, "dist/plugin/continuation-enforcer.js"),
    format: "es",
  },
});
