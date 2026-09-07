# Plan 007: Release engineering, documentation, and publish

> **Executor instructions**: Verification-gated checklist — NO TDD here
> (docs and release wiring are not test-first material; every step has a
> machine-checkable gate instead). Complete Plans 004–006 first. One owner
> decision (LICENSE) is required before the publish step — see Step 6.
>
> **Drift check**: `git diff --stat <006-final-commit>..HEAD -- package.json README.md`

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW (except publish: irreversible — gated behind owner confirmation)
- **Depends on**: `plans/006-uninstall-update-status-doctor-tdd.md`
- **Category**: dx
- **Planned at**: commit created by Plan 006 completion, 2026-09-06
- **Method**: verification-gated release checklist (no TDD; SDD not applicable)

## Why this matters

This plan makes the package publishable and honest: postinstall must not
silently mutate machines (Oracle's review finding), the tarball must provably
contain the dist artifact and dot-directory payloads (Momus verified `files[]`
overrides dotfile exclusion), and the README must replace the old
"copy manually" instructions with the installer contract — including the
default-ON plugin decision (D2) that contradicts the current opt-in docs.

## Current state

- `install.mjs` complete: install/uninstall/update/status/doctor, `--json`,
  `--gitignore-state`, exit codes 0/1/2, zero deps.
- `package.json` has bin, engines, devDeps, build/gen:manifest/test scripts.
  Missing: `files[]`, `prepack`, `postinstall`, `test` aggregate.
- `README.md` documents MANUAL copy/symlink install and says the plugin is
  OPT-IN by presence; plugin header comment says the same. Both now wrong
  relative to D2 (installer default ON).
- `.opencode/plugin/continuation-enforcer.ts` header comment (lines 8–10)
  states the opt-in-by-presence contract.
- No LICENSE file exists. The plugin dev pin lives in `.opencode/package.json`
  (gitignored) and at root devDeps (Plan 004).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Full build+manifest+tests | `npm run build && npm run gen:manifest && npm test` | exit 0 |
| Pack inspection | `npm pack --dry-run 2>&1 \| tee /tmp/pack.log` | file list contains required entries |
| Publish (owner-approved) | `npm publish` (or `npm publish --access public` if scoped) | exit 0 |

## Scope

**In scope**:
- `package.json` (files[], prepack, postinstall, test aggregate)
- `scripts/verify-pack.mjs`
- `README.md` (rewrite install/plugin/restart sections)
- `.opencode/plugin/continuation-enforcer.ts` (HEADER COMMENT ONLY — lines
  1–11; do not touch code below line 12)
- `LICENSE` (after owner decision)
- `.github/workflows/ci.yml` (optional, lightweight: install + tests on push)**Out of scope**:
- Any installer behavior change (that's Plans 005–006 territory)
- Plugin logic changes
- Version beyond 0.1.0

## Git workflow

- Commits: `docs(readme): document installer contract and default-on plugin`,
  `build(npm): finalize files, prepack, and instruction-printing postinstall`,
  `chore: add MIT license` (per owner decision).
- Publish is executed from a clean `git status` only.

## Steps

### Step 1: Finalize package.json release fields

- `files`: `["dist/", ".opencode/agent/", ".opencode/command/", "install.mjs",
  "manifest.json", "README.md", "LICENSE"]`.
- `prepack`: `npm run build && npm run gen:manifest && npm test`.
- `test`: `node --test tests/ && bun test tests/continuation-state.test.ts`.
- `postinstall`: node inline script that (a) prints the two install commands
  (project: `npx <name> install`, global: `npx <name> install --scope global`)
  and (b) ONLY when env `OPENCODE_SPECIAL_AGENTS_AUTO_INSTALL=1`, spawns
  `node install.mjs install --scope global --plugin on --yes`; on failure
  prints `WARNING: auto-install failed: <reason>; run 'npx <name> install'
  manually` and exits 0 (surfaced, never silently swallowed, never blocks
  npm install). NO `|| true` masking anywhere.
Verify: `node -e "const p=require('./package.json'); if(!p.files.includes('dist/')||!p.scripts.prepack)process.exit(1)"` → exit 0.

### Step 2: Pack verification gate

`scripts/verify-pack.mjs`: run `npm pack --dry-run`, parse the file list,
assert presence of: `dist/plugin/continuation-enforcer.js`, all 8
`.opencode/agent/*.md`, all 3 `.opencode/command/*.md`, `manifest.json`,
`install.mjs`, `LICENSE`; assert total file count < 40 (no leakage of tests/
plans/ docs/ node_modules/).
Add script `verify:pack`.
Verify: `npm run verify:pack` → exit 0 with the assertion summary.

### Step 3: Update the plugin header contract (comment only)

Rewrite `.opencode/plugin/continuation-enforcer.ts` lines 1–11 to state:
enabled by installer DEFAULT (`--plugin off` to skip); presence of the
installed artifact enables the feature; removal disables; restart required.
Code below line 12 untouched.
Verify: `git diff -- .opencode/plugin/continuation-enforcer.ts` shows ONLY
comment lines changed; `npm run build` still green (comment is dropped by
bundler anyway).

### Step 4: README rewrite (installer contract)

Replace manual-install sections with:
1. **Install matrix**: project (`npx <name> install` — default scope),
   global (`npx <name> install --scope global`), from checkout
   (`node install.mjs install`), postinstall behavior + the
   `OPENCODE_SPECIAL_AGENTS_AUTO_INSTALL=1` opt-in.
2. **Commands table**: install/uninstall/update/status/doctor + flags
   (`--dry-run --yes --plugin --scope --source --root --json --purge --force
   --gitignore-state --allow-self-install`).
3. **Plugin section**: default ON, `--plugin off`, removal disables.
4. **Restart matrix**: agents, commands, and plugin ALL require OpenCode
   restart (config loads at startup, never hot-reloaded).
5. **State file**: location, purpose, `--gitignore-state`, report-only
   uninstall safety.
6. **Precedence note**: project-scope files shadow global for the same name.
7. Keep the existing prompt-vs-permission honesty section and role table.
Verify: `grep -c "restart" README.md` ≥ 3; `grep "npx" README.md` non-empty;
no remaining "copy or symlink" manual-install instruction
(`grep -in "copy or symlink" README.md` → no match).

### Step 5: CI (optional but recommended)

`.github/workflows/ci.yml`: on push/PR — setup Node 20 + Bun, `npm install`,
`npm test`, `npm run verify:pack`. Single job, no matrix needed for v0.1.0.
Verify: YAML parses (`node -e "require('fs')" && npx --yes yaml-lint
.github/workflows/ci.yml` or equivalent); skip gracefully if user declines CI.

### Step 6: LICENSE — OWNER DECISION (blocking publish)

Ask the owner which license (suggest MIT to match ecosystem norms; the
inspiration repo uses SUL-1.0 — do NOT copy it without owner intent).
STOP until answered. Then add LICENSE + `"license"` field.
Verify: LICENSE exists; package.json license field set.

### Step 7: Publish procedure (owner-approved)

1. Confirm clean tree: `git status` empty.
2. `npm run prepack && npm run verify:pack` locally.
3. `npm publish` (add `--access public` if scoped name).
4. Post-publish smoke: `npm view <name>@0.1.0` shows the tarball;
   in a `mktemp -d` project: `npx <name>@0.1.0 install --dry-run` prints the
   12-file plan.
Verify: all four sub-steps exit 0.

### Step 8: Hand-test gate (real OpenCode)

In a throwaway project: real (non-dry) install; run `opencode agent list`
→ the 8 agents appear (1 primary + 7 subagents); confirm
`plugin/continuation-enforcer.js` present in target; note the restart
requirement in the report (a running OpenCode will not see changes).
Verify: `opencode agent list` output includes `sisyphus` and `oracle`.

## Test plan

No new unit tests (by design — method is verification gates). The regression
suite must stay green after every step:
`npm test` (node:test suites + bun plugin tests).

## Done criteria

- [ ] `npm pack --dry-run` verified by `scripts/verify-pack.mjs` (exit 0)
- [ ] postinstall prints instructions; auto-install strictly env-gated; no
      `|| true` in any script
- [ ] README documents install matrix, commands, restart matrix, state file,
      precedence; manual-copy instructions removed
- [ ] Plugin header reflects default-ON contract; diff is comment-only
- [ ] LICENSE decided by owner and present
- [ ] Published (or explicitly deferred by owner) with post-publish smoke
- [ ] `opencode agent list` hand-test passes in a throwaway project
- [ ] `plans/README.md` status row updated

## STOP conditions

- Owner unavailable for the LICENSE decision → complete Steps 1–5, mark plan
  BLOCKED at Step 6 with reason.
- `npm publish` fails on name collision (registry state changed since Plan
  004's check) → report; do not rename unilaterally.
- Pack verification finds payload leakage twice after fixes → stop, audit
  `files[]` and `.gitignore` together, report.
- Hand-test shows OpenCode does NOT discover installed agents → report
  versions and discovery output; do not hack around the loader.

## Maintenance notes

- Every future version bump: `npm version patch|minor` → prepack rebuilds
  manifest hashes automatically — never hand-edit manifest.json.
- Postinstall message text and the env-var name are user-facing contracts;
  change them only with a migration note in README.
- If OpenCode changes plugin discovery (e.g. drops `.js` support), Plan 004's
  verify-build + this plan's hand-test gate are the tripwires.
