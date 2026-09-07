# Plan 004: Build the dist artifact and manifest foundation

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving on. If a
> STOP condition fires, stop and report — do not improvise. When done, update
> the status row for this plan in `plans/README.md`.
>
> **Method**: HYBRID. Steps 5–7 (manifest generator) are STRICT TDD — write the
> failing `node:test` first, then implement, then refactor. Steps 2–4 (build
> configuration) are verification-gated configuration, not TDD-able.
>
> **Drift check**: The workspace may still be unversioned. Step 0 creates the
> git baseline; after that, `git diff --stat <baseline>..HEAD` on in-scope paths
> is the drift check for successor plans.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none (Plans 001–003 are DONE and provide the payload)
- **Category**: dx
- **Planned at**: unversioned directory, 2026-09-06 (git init happens in Step 0)
- **Method**: hybrid (TDD for manifest generator; verification gates for build)

## Why this matters

The installer (Plans 005–006) must ship a plugin artifact that works in any
OpenCode install with zero runtime dependencies, and must know exactly which
files it owns (with integrity hashes). This plan produces both: a rolldown-
bundled single-file ESM plugin under `dist/`, and a normative `manifest.json`
that later plans treat as the sole source of payload truth.

Verified facts this plan relies on:

- `.opencode/plugin/continuation-enforcer.ts` line 13:
  `import type { Plugin } from "@opencode-ai/plugin";` — type-only, erased at
  build. Lines 14–20 import only from `../lib/continuation-state.ts` (local).
  Therefore the bundle has ZERO runtime npm dependencies.
- OpenCode (Bun runtime) auto-discovers `*.js` plugins in
  `.opencode/plugin/`; agents and commands load from `agent/` and `command/`.
- `.opencode/package.json` pins `@opencode-ai/plugin@1.18.29` for the raw-TS
  dev workflow (gitignored, dev-only — untouched by this plan).
- npm `files[]` enumeration overrides default dotfile-dir exclusion, so
  `.opencode/agent/**` can ship in the tarball (finalized in Plan 007).

## Current state

Files that exist and must not be behaviorally changed:

- `.opencode/agent/{sisyphus,hephaestus,prometheus,oracle,scout,librarian,metis,momus}.md` (8 agents)
- `.opencode/command/{plan,review-plan,ultrawork}.md` (3 commands)
- `.opencode/plugin/continuation-enforcer.ts` + `.opencode/lib/continuation-state.ts`
- `tests/continuation-state.test.ts` (29 bun:test tests, import the TS source)
- `README.md`, `docs/inspiration-map.md`, `plans/*.md`

Files that do NOT exist yet: root `package.json`, `rolldown.config.mjs`,
`manifest.json`, `dist/`, `scripts/`, root `.gitignore`, git repository.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Node version | `node --version` | >= v20 |
| Bun version | `bun --version` | any (dev tool) |
| Build | `pnpm run build` | exit 0, exactly 1 file in dist/ |
| Plugin tests | `bun test tests/continuation-state.test.ts` | 29 pass, 0 fail |
| Manifest tests | `node --test tests/manifest.test.mjs` | all pass |
| Generate manifest | `pnpm run gen:manifest` | exit 0, manifest.json updated |

## Scope

**In scope**:
- `package.json` (root, create)
- `rolldown.config.mjs` (create)
- `scripts/verify-build.mjs`, `scripts/smoke-dist.mjs`, `scripts/gen-manifest.mjs` (create)
- `tests/manifest.test.mjs` + `tests/fixtures/payload/**` (create)
- `manifest.json` (generated, committed)
- `.gitignore` (root, create)
- git repository initialization

**Out of scope**:
- `install.mjs` (Plan 005), uninstall/update/status/doctor (Plan 006)
- `files[]`, `prepack`, `postinstall` in package.json (Plan 007)
- Any change to agent/command/plugin Markdown or TS sources
- The `.opencode/package.json` dev pin (stays as-is)

## Git workflow

- Step 0 runs `git init` and commits the current tree as baseline.
- Branch: `main` is fine for solo work; otherwise `advisor/004-build-foundation`.
- Commit per work unit, conventional style, e.g.
  `build: add rolldown single-file ESM bundle for continuation plugin`,
  `feat(manifest): add deterministic payload manifest generator and tests`.
- Never commit secrets; no push unless instructed.

## Steps

### Step 0: Create the git baseline

`git init`, `git add -A`, commit `chore: baseline before installer work`.
Verify: `git log --oneline -1` shows the commit.

### Step 1: Decide the package name

Run `npm view opencode-special-agents version`.
- If 404 (name free) → use `opencode-special-agents`.
- If taken → use scoped `@metalbolicx/opencode-special-agents` (matches the
  user's existing `@metalbolicx/opencode-ponytail` naming).
Record the chosen name; Plans 005–007 reuse it verbatim.
Verify: chosen name recorded in the step report.

### Step 2: Create the root package.json

Fields: `name` (from Step 1), `version: "0.1.0"`, `description`, `type:
"module"`, `"engines": {"node": ">=20"}`, `devDependencies`: `rolldown`
(pinned exact version) and `@opencode-ai/plugin` `1.18.29`, `scripts`:
`build`, `gen:manifest`, `test:plugin`
(`bun test tests/continuation-state.test.ts`). Do NOT add `bin` yet — npm
links bin targets at install time and `install.mjs` only exists after Plan
005 Step 8. No `files[]`, no publish scripts yet (Plan 007).

Verify: `pnpm install` exits 0; `node -e "console.log(require('./package.json').name)"`.

### Step 3: Add the rolldown build with a single-artifact assertion

`rolldown.config.mjs`: input `.opencode/plugin/continuation-enforcer.ts`,
output `dist/plugin/continuation-enforcer.js`, format `es`.
`scripts/verify-build.mjs`: assert (a) `dist/` contains EXACTLY one file,
(b) the artifact contains no top-level `import` statements
(regex `/^import\s/m` must not match — zero runtime deps proof),
(c) file size > 0. `pnpm run build` = `pnpm exec rolldown -c && node scripts/verify-build.mjs`.

Verify: `pnpm run build` → exit 0; `find dist -type f | wc -l` → `1`.

### Step 4: Smoke-execute the artifact under Bun

`scripts/smoke-dist.mjs`: dynamic `import()` of the dist artifact, assert
`typeof mod.default === "function"`, print `SMOKE OK`.
Verify: `bun scripts/smoke-dist.mjs` → `SMOKE OK`, exit 0.

### Step 5: TDD — manifest generator tests FIRST

Create `tests/fixtures/payload/` mirroring a minimal payload: one agent md,
one command md, one `dist/plugin/continuation-enforcer.js` (content is
irrelevant; hashes are computed from bytes).

Create `tests/manifest.test.mjs` (node:test) covering, against the fixture:

1. generateManifest produces EXACTLY the manifest schema v1 below (deep-equal
   against a precomputed expected object).
2. sha256 values match `sha256sum` output for known fixture bytes.
3. Deterministic ordering: files sorted by `dest`, independent of FS walk order.
4. Rejects a payload path that escapes the root (`../evil` fixture) with a
   clear error, no manifest written.
5. Rejects a plugin entry whose dist artifact is missing.
6. `kind` mapping: `.opencode/agent/**` → `agent` + `dest: agent/<name>.md`;
   command → `command/<name>.md`; plugin dist → `plugin/<name>.js`.
7. Round-trip: generated manifest validates against the same validator used at
   install time (schema fields present, hex shas, dest containment).

**Normative contract — manifest schema v1** (this text is the spec; Plans 005–006 consume it):

```json
{
  "name": "<package name from Step 1>",
  "version": "<package.json version>",
  "schemaVersion": 1,
  "files": [
    {
      "source": ".opencode/agent/sisyphus.md",
      "dest": "agent/sisyphus.md",
      "kind": "agent",
      "sha256": "<64 lowercase hex>"
    },
    {
      "source": "dist/plugin/continuation-enforcer.js",
      "dest": "plugin/continuation-enforcer.js",
      "kind": "plugin",
      "sha256": "<64 lowercase hex>"
    }
  ]
}
```

`dest` is relative to the install target root (project `.opencode/` or the
global config dir). All 8 agents and 3 commands appear; the plugin appears once.

Run: `node --test tests/manifest.test.mjs` → ALL FAIL (module not implemented).
This red state is required before Step 6.

### Step 6: Implement the generator to green

`scripts/gen-manifest.mjs`: export `generateManifest(sourceDir)` (pure:
walks `.opencode/agent`, `.opencode/command`, `dist/plugin`; computes sha256;
validates containment; returns the object) plus a `main` guard that writes
`manifest.json` at the repo root. `pnpm run gen:manifest` = `node scripts/gen-manifest.mjs`.

Verify: `node --test tests/manifest.test.mjs` → all pass (green).

### Step 7: Generate and commit the real manifest; ignore build output

Add root `.gitignore`: `node_modules/`, `dist/`, `*.bak.*`, `.staging-*`.
Run `npm run build && npm run gen:manifest`. Spot-check one hash:
`sha256sum .opencode/agent/sisyphus.md` equals the manifest entry (lowercase hex).
Commit manifest.json (dist/ stays ignored — regenerated at prepack, Plan 007).

Verify: `node -e "const m=require('./manifest.json'); console.log(m.files.length)"`
→ `12` (8 agents + 3 commands + 1 plugin).

## Test plan

- `tests/manifest.test.mjs` (new, node:test): the 7 cases in Step 5.
- Existing `bun test tests/continuation-state.test.ts` must remain 29/29
  (proves the dev TS workflow was untouched).
- Structural pattern to follow: plain node:test with `assert/strict`, fixtures
  created in `os.tmpdir()` copies where mutation is needed.

## Done criteria

- [ ] `pnpm run build` exits 0 and emits exactly one file under `dist/`
- [ ] `bun scripts/smoke-dist.mjs` prints `SMOKE OK`
- [ ] `node --test tests/manifest.test.mjs` all pass (TDD evidence: red first)
- [ ] `manifest.json` exists, `files.length === 12`, hashes spot-checked
- [ ] `bun test tests/continuation-state.test.ts` still 29/29
- [ ] Root `.gitignore` covers node_modules/dist/backups/staging
- [ ] No file outside the in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Both package names (plain and scoped) are taken on npm.
- rolldown cannot resolve the `.ts` extension in the relative import (it
  should — oxc resolves TS natively; if it fails, report, do not switch tools).
- `@opencode-ai/plugin@1.18.29` cannot be installed at the root.
- The bundle contains unresolved external imports (verify-build fails after
  two fix attempts).

## Maintenance notes

- Bump `version` in package.json → rerun `gen:manifest` in the same change.
- Any edit to plugin or agent sources requires rebuild + manifest regen; the
  installer (Plan 005) enforces this by validating hashes.
- Pin rolldown exactly; its output bytes are part of the manifest hashes.
