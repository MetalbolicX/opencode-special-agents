# Plan 005: Implement the install transaction with strict TDD

> **Executor instructions**: This plan is STRICT TDD. For every behavior
> cluster: (1) write failing `node:test` tests, (2) run and confirm red,
> (3) implement the minimum in `install.mjs`, (4) confirm green, (5) refactor.
> Never write implementation before its red test. Complete Plan 004 first.
>
> **Drift check**: `git diff --stat <004-final-commit>..HEAD -- install.mjs tests/`
> — if in-scope files changed since planning, re-read them before proceeding.

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/004-build-dist-and-manifest.md`
- **Category**: dx
- **Planned at**: commit created by Plan 004 completion, 2026-09-06
- **Method**: strict TDD (node:test; tests are the executable spec)

## Why this matters

The install transaction is the product: it must be idempotent, integrity-
checked, crash-recoverable, non-destructive to user edits, and honest about
`--dry-run`. These properties are exactly the ones shortcuts break. Test-first
is non-negotiable here because every guarantee in the marketing (and the
review by Oracle/Momus) maps to a test in this plan.

Architecture locked by the finalized plan (do not revisit):

- COPY-ONLY: no `opencode.json` reads or writes in any scope. Directory
  discovery loads agents/commands/plugins in both project and global scopes.
- The payload source of truth is `manifest.json` (schema v1, Plan 004).
- Transaction invariant: stage → validate → promote; the STATE FILE IS WRITTEN
  LAST. Crash recovery infers safely because state absence means "not installed".
- Plugin default ON (`--plugin off` opt-out) — owner decision D2.
- Default scope PROJECT; `--scope global` opts into the config dir — D1.
- Conflict policy: prompt when interactive; `--yes` or non-TTY → KEEP the
  user's file — D4.

## Current state

- `install.mjs` does not exist. `package.json` already declares
  `"bin": {"opencode-special-agents": "./install.mjs"}` (Plan 004).
- `manifest.json` exists at repo root with 12 file entries (schema v1).
- `dist/plugin/continuation-enforcer.js` builds via `pnpm run build`.
- No CLI-test infrastructure exists yet. OpenCode installed (1.18.29) for the
  final hand-test (Plan 007, not this plan).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Installer tests | `node --test tests/install.test.mjs` | all pass |
| Manifest tests (regression) | `node --test tests/manifest.test.mjs` | all pass |
| Plugin tests (regression) | `bun test tests/continuation-state.test.ts` | 29 pass |
| Build (before testing install) | `pnpm run build && pnpm run gen:manifest` | exit 0 |

## Suggested executor toolkit

- Use `node:test` + `assert/strict` only — the CLI must stay zero-dependency,
  and so must its tests.
- Spawn pattern for CLI-level tests:
  `spawnSync(process.execPath, [INSTALL, ...args], {cwd: fixtureDir, env})`.
- Fixture helper `mkSource()` / `mkTarget()`: copy `tests/fixtures/payload`
  into `os.tmpdir()` subdirs; never test against the real repo tree.

## Scope

**In scope**:
- `install.mjs` (create; single file, zero deps, dual-entry: exports
  internals for unit tests + ESM main guard for CLI)
- `tests/install.test.mjs` (+ shared `tests/helpers/cli.mjs` if needed)
- `tests/fixtures/**` extensions for conflict/crash fixtures
- `package.json` scripts: `test:installer`

**Out of scope**:
- `uninstall`, `update`, `status`, `doctor`, `--json`, `--gitignore-state`
  (Plan 006)
- `postinstall`, `prepack`, `files[]`, publishing (Plan 007)
- Any change to manifest schema or payload sources

## Git workflow

- One commit per GREEN TDD cluster, conventional style:
  `test(install): capture source resolution contract (red)` then
  `feat(install): resolve source dir with manifest identity walk-up`
  — or a single commit per cluster containing test+implementation
  (preferred: tests stay with the behavior they verify).
- Do NOT push or open a PR unless instructed.

## Steps (each step = one TDD cluster: red → green → refactor)

### Step 1: CLI skeleton contract

RED: tests for — no args prints usage exit 0; `-h/--help` prints usage exit 0;
unknown command prints error + usage exit 2; `--dry-run` accepted syntactically.
GREEN: `install.mjs` with `USAGE` constant, raw arg parser
(`--scope <v> --plugin <on|off> --dry-run --yes --source <path> --root <path>
--allow-self-install`), dispatch, main guard
(`if (import.meta.url === pathToFileURL(process.argv[1]).href)`).

### Step 2: Source resolution

RED: — (a) walking up from cwd finds a directory containing `manifest.json`
whose `name` matches the expected package name AND `schemaVersion === 1`
(identity check); (b) `--source` overrides the walk; (c) a foreign
`manifest.json` (wrong/missing name or schemaVersion) is rejected exit 2;
(d) payload containment: any manifest `source` resolving outside the source
root aborts before any filesystem write.
GREEN: `resolveSourceDir()` + `loadManifest()` + `verifyPayload()` (recompute
sha256 of every `source`; mismatch → abort exit 2, ZERO writes — assert the
target fixture is byte-identical after the failed run).

### Step 3: Target resolution

RED: — default target is `<cwd>/.opencode/`; `--scope global` targets
`$OPENCODE_CONFIG_DIR ?? ~/.config/opencode/`; tests inject both via `env`
and via `--root <dir>` override (the `--root` flag exists for testability and
power users; document in USAGE).
GREEN: `resolveTargetDir({scope, rootArg, env, home})`.

### Step 4: Install plan + conflict policy (pure functions)

RED: unit tests (import internals, no spawn) for `planInstall(manifest,
existingFiles, {plugin, state})`:
- fresh target → all dispositions `create`
- identical sha present → `unchanged`
- different sha present → `conflict`
- `--plugin off` excludes `kind: "plugin"` entries
And `resolveConflict(disposition, {yes, tty})`:
- interactive TTY → returns `prompt` (thin wrapper, not spawn-tested)
- `--yes` or non-TTY → returns `keep`
GREEN: implement both as pure exports.

### Step 5: Transaction apply (stage → validate → promote → state LAST)

RED: spawn tests against tmpdir fixtures:
1. Happy path: 12 files land at `dest` (relative to target), shas match
   manifest, state file exists.
2. Idempotency: second run performs ZERO writes (snapshot mtimes+sizes of all
   target files before/after).
3. Crash recovery: fixture where payload files exist but NO state file
   (simulated interrupted install) → re-run completes install, writes state,
   leaves consistent tree; leftover `.staging-*` sibling dir from the "crash"
   is cleaned.
4. Backups: when a conflict resolves to overwrite (forced via a policy
   override fixture), the pre-existing file is copied to
   `<target>/.opencode-special-agents.backups/<basename>.bak.<ISO>`;
   rotation keeps at most 3.
5. `--dry-run`: prints the plan (per-file disposition); ZERO filesystem
   mutations (byte-snapshot whole target tree before/after).
GREEN: `applyInstall()` — stage all payload files into
`<target-sibling>/.staging-<pid>/`, validate staged shas, promote per-file
with `rename`, write state LAST.

**Normative contract — state file schema v1** (written at
`<target>/.opencode-special-agents.json`; Plans 006–007 consume it):

```json
{
  "schemaVersion": 1,
  "name": "<package name>",
  "version": "<manifest version at install time>",
  "scope": "project|global",
  "target": "<absolute target dir>",
  "installedAt": "<ISO 8601 UTC>",
  "pluginEnabled": true,
  "files": [
    {"dest": "agent/sisyphus.md", "sha256": "<hex>", "disposition": "created|overwritten|kept|unchanged"}
  ]
}
```

### Step 6: Conflict UX for real runs

RED: spawned non-TTY run with a pre-modified target file: file is KEPT
byte-identical, state records `"disposition": "kept"`, stdout prints a
`KEPT (user-modified): agent/sisyphus.md` warning line.
GREEN: wire `resolveConflict` output into apply; print unified diff preview
only in interactive mode (untested wrapper; the diff helper itself is unit-
tested: known two-string input → expected +/- lines).

### Step 7: Self-install guard

RED: fixture where the resolved target equals the source repo's own
`.opencode/` dir (create a fake source containing its own `.opencode/agent/`
matching manifest dests) → plain run aborts exit 2 with
`self-install detected; pass --allow-self-install to proceed`;
with `--allow-self-install` → proceeds normally.
GREEN: compare resolved target against `<sourceDir>/.opencode`.

### Step 8: Wire the bin + regression sweep

Make `install.mjs` executable (shebang `#!/usr/bin/env node`, `chmod +x`).
Add to root `package.json` (deferred from Plan 004 — npm links bin targets at
install time, so the file must exist first):
`"bin": {"opencode-special-agents": "./install.mjs"}`.
Verify the link: `pnpm install` (re-run to refresh .bin) then
`./node_modules/.bin/opencode-special-agents --help` prints usage.
Add `test:installer` script. Full suite:
`pnpm run build && pnpm run gen:manifest && node --test tests/manifest.test.mjs tests/install.test.mjs && bun test tests/continuation-state.test.ts`.

## Test plan

All tests live in `tests/install.test.mjs` (plus unit imports). Coverage
matrix (every row = at least one named test):

| Behavior | Level |
|---|---|
| usage/help/unknown-command exits | spawn |
| source walk-up + identity + `--source` | spawn |
| foreign manifest rejected | spawn |
| payload traversal containment | spawn |
| sha integrity abort = zero writes | spawn |
| target project/global/`--root`/env | unit |
| plan dispositions create/unchanged/conflict/plugin-off | unit |
| conflict `--yes`/non-TTY → keep | unit + spawn |
| happy-path install + state | spawn |
| idempotent second run (zero writes) | spawn |
| crash recovery (no-state + stale staging) | spawn |
| backup rotation ≤ 3 on overwrite | spawn |
| `--dry-run` zero mutations | spawn |
| kept-file warning + state disposition | spawn |
| self-install abort / `--allow-self-install` | spawn |
| unified diff helper | unit |

## Done criteria

- [ ] `node --test tests/install.test.mjs` all pass, with red-first history in
      the commit sequence (tests committed with or before implementation)
- [ ] Full regression: manifest tests + 29 bun plugin tests still green
- [ ] `install.mjs` has zero third-party imports
      (`grep -nE 'from "' install.mjs` → only relative/`node:` matches)
- [ ] State file written last is observable: crash fixture recovers cleanly
- [ ] `--dry-run` provably writes nothing
- [ ] No file outside in-scope list modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 004 artifacts missing or manifest hashes stale (rebuild first).
- A TDD cluster cannot reach green after two honest attempts — report the
  failing assertion, do not weaken the test.
- Spawn tests prove flaky on this platform twice — report; do not switch test
  runner unilaterally.
- Implementation requires a dependency (forbidden: zero-dep CLI).

## Maintenance notes

- Every new flag must extend Step 1's usage test first.
- The state schema is a public contract for Plans 006–007; changes require a
  schemaVersion bump and a migration note here.
- Interactive prompts are deliberately thin untested wrappers around tested
  pure policy functions — keep them that way.
