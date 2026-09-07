# Plan 009: Fix bin-shim no-op and doctor false-ok, ship 0.1.1

> **Executor instructions**: This plan is strict TDD for the two fixes
> (shim guard, doctor empty-install) and verification-gated for release.
> Read this file fully before any other action. Hold Step 6 (publish) until
> the orchestrator gives the explicit go — execute Steps 1–5 + 7 only.
>
> **Method**: strict TDD (shim guard, doctor verdict), verification-gated
> for build/pack/release (no TDD on metadata).

## Status

- **Priority**: P1 — published artifact broken for all consumers
- **Effort**: S
- **Risk**: MED (release of a previously-broken package)
- **Depends on**: none (Plans 004–008 landed)
- **Category**: dx
- **Planned at**: post `690c898`, 2026-09-07
- **Method**: strict TDD for fixes, verification-gated for release

## Why this matters

`opencode-special-agents@0.1.0` is published, but every consumer
invocation via the npm/npx bin is a **silent no-op** (main guard fails
through the bin symlink). The owner's machine only works because
`install.mjs` was invoked directly from the repo checkout. Additionally,
`doctor` reports `ok`/`No issues found` on a target with zero installed
files (false negative). Consumers need 0.1.1.

Two shipping defects, both verified live:

1. **`install.mjs:1176`** — main guard `import.meta.url ===
   pathToFileURL(process.argv[1]).href` fails when Node executes the bin
   symlink: `argv[1]` is the shim path, `import.meta.url` is the real
   file path → `main()` never runs → exit 0, zero output. Tests never
   caught it because they invoke `node install.mjs` directly (real path
   on both sides).
2. **`install.mjs:835-850`** — when no state file exists, the doctor
   checks manifest dests against the target but **never sets `hasDrift`
   for missing files in that branch** → all-missing → no diagnostic →
   `ok`, `No issues found`, exit 0.

## Current state

- `package.json` version `0.1.0`; published to npm (verified via
  `npm view opencode-special-agents version` → `0.1.0`).
- Owner's global install (`~/.config/opencode/`) is now correctly
  populated from a direct source install; serves as a live regression
  fixture for doctor (must stay `ok`/exit 0).
- 64 installer node tests + 29 bun tests passing.
- pnpm workflow throughout.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Run only the new shim test | `node --test tests/bin-shim.test.mjs` | red first, green after fix |
| Run only the new doctor test | `node --test tests/doctor-empty.test.mjs` | red first, green after fix |
| Full suite | `pnpm test` | 73+ node + 29 bun pass |
| Build | `pnpm run build` | exit 0, 1 dist file |
| Pack verify | `pnpm run verify:pack` | exit 0 |
| Version bump | `pnpm version patch` | 0.1.1 |
| Manifest regen | `pnpm run gen:manifest` | exit 0, `version` updated |

## Scope

**In scope**: `install.mjs`, `tests/bin-shim.test.mjs` (new),
`tests/doctor-empty.test.mjs` (new), `package.json` (version bump),
`manifest.json` (regenerated), `plans/README.md` (row 009), this file.

**Out of scope**: agent/command .md files, `install.mjs` features beyond
the two fixes, README root, `.github/workflows/`, postinstall changes.

## Git workflow

3–4 conventional commits:
- `fix(cli): resolve bin symlink in main guard`
- `fix(doctor): report missing installs instead of ok`
- `test(install): add bin-shim and doctor-empty coverage`
- `chore: release 0.1.1`

The version bump may be its own commit (`0.1.1`) or combined with the
manifest regen; keep manifest regen in the same commit as the version
bump (Plan 007 maintenance contract).

## Steps (each step = one TDD cluster: red → green → refactor)

### Step 1: Bin-shim regression test (RED)

Create `tests/bin-shim.test.mjs` using `node:test` + `assert/strict`
+ `node:child_process` `spawnSync`, `node:fs` `symlinkSync`/`mkdtempSync`,
`node:path`, `node:os`, `node:crypto`. Tests must reproduce the exact
symlink-invocation condition:

1. **Help through symlink**: create `mkdtempSync`-backed tmpdir,
   symlink `<tmp>/bin-link → <repo>/install.mjs`, run
   `spawnSync(process.execPath, [link, "--help"])`. Assert
   `result.status === 0` AND stdout is non-empty AND contains
   `"Usage"` (case-insensitive).
2. **Subcommand through symlink**: with a separate tmpdir as a fake
   target, `spawnSync(process.execPath, [link, "status", "--scope",
   "project", "--root", tmpTarget, "--source", repoRoot])`. Assert
   stdout non-empty AND contains `"Target:"` (status' human header).

Run this file. **Both tests must FAIL** (empty stdout, exit 0) before
the fix lands. Commit the failing test alone:

`test(install): add bin-shim coverage (red)`

### Step 2: Fix the main guard (GREEN)

Edit `install.mjs:1176`. Current guard:

```js
if (import.meta.url === pathToFileURL(process.argv[1]).href) { ... }
```

Replace with a realpath-to-realpath comparison wrapped in try/catch
(argv[1] may be absent when imported as a module by the existing
install/uninstall tests — guard must stay false in that case):

```js
import { realpathSync } from "node:fs"; // add to existing import list
// ...
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
if (isMainEntry()) { main(); }
```

Confirm `tests/bin-shim.test.mjs` is green, the full suite is still
green (no test regressions), and the guard still works when imported
(`tests/install.test.mjs` and `tests/cli-extra.test.mjs` import
internals — their import path goes through `node:fs` resolution, not
through argv). Commit:

`fix(cli): resolve bin symlink in main guard`

### Step 3: Doctor empty-install verdict (RED → GREEN)

Create `tests/doctor-empty.test.mjs`. RED tests:

1. **Empty target, no state, no files**: spawn
   `node install.mjs doctor --scope project --root <empty tmpdir>
   --json`. Assert `result.status === 1`,
   `JSON.parse(stdout).result === "degraded"`, and diagnostics contains
   an entry `{level: "warn", code: "INSTALL_MISSING", ...}` with
   message mentioning `install`.
2. **Empty target text mode**: same fixture, without `--json`. Assert
   exit 1, stdout contains `degraded` AND `INSTALL_MISSING`.
3. **Files present without state**: pre-create one manifest-dest file in
   a tmpdir from the fixture; run doctor. Assert exit 1, result
   `degraded`, diagnostic `INSTALL_MISSING` (allow message variant
   about partial presence).
4. **Negative guard**: the owner's real install at
   `~/.config/opencode/` must still produce `result === "ok"`,
   `status === 0`. This is the live regression. Run
   `node install.mjs doctor --scope global` from the repo; assert the
   shape.

Run this file — assert RED on tests 1–3, GREEN on test 4 (the
existing buggy doctor accidentally passes "no issues" for test 4 which
is correct; keep it green).

GREEN implementation in `install.mjs:835-850` (the no-state branch):

- When `state === null`:
  - If every manifest dest is missing → push diagnostic
    `{level: "warn", code: "INSTALL_MISSING", message: "Package is not
    installed in this scope. Run: install <scope>"}`, exit 1.
  - If some manifest dests are present → push the same
    `INSTALL_MISSING` with a message variant noting partial presence and
    recommending reinstall to rebuild state. exit 1.
- Do **not** set `hasDrift` separately for these missing files (avoid
  duplicating FILE_DRIFT); `INSTALL_MISSING` is the headline finding.
- Keep diagnostic codes additive (codes are public; add, never rename).
  Schema v1 unchanged.
- Text mode: ensure the diagnostics block prints so the user sees the
  new code (already handled by the existing print loop; verify).

Confirm all 4 tests green; confirm `pnpm test` green. Commit:

`fix(doctor): report missing installs instead of ok`

### Step 4: Success confirmation output (UX)

In the success path of `runInstall` and `runUpdate`, after the state
file is written and before return, add one summary line:

```
Installed 12 files (<scope>) at <targetDir>; restart OpenCode to load them.
```

Use the same line for both `install` and `update` (update prints the
same on full success). If the existing install/CLI tests assert silent
stdout, update those tests to allow this line — silence is the defect
that caused the original confusion. Verify no test relies on exact
stdout string match beyond the new line. Commit (may be combined with
Step 3 if the diffs touch the same regions):

`fix(install): print success summary line`

### Step 5: Release prep

1. `pnpm version patch` → `0.1.1` (creates its own commit).
2. `pnpm run gen:manifest` (manifest `version` field updates to
   `0.1.1`). Commit:
   `chore: regenerate manifest for 0.1.1 release`
   (combine with the version commit if simpler).
3. `pnpm run build && pnpm run verify:pack && pnpm test`.
4. Clean working tree, all suites green.

### Step 6: Publish — HOLD

**DO NOT run `pnpm publish`.** Step 6 is irreversible and waits for the
orchestrator's explicit go in a separate instruction. Your job ends at
a clean, green, version-bumped, manifest-regenerated tree.

### Step 7: Bookkeeping

- Update `plans/README.md` row 009 → DONE only after Step 5 gates
  pass.
- Commit the index update with a conventional message.

## Done criteria

- [ ] Shim test red-first → green; `--help` and `status` through
      symlink both print non-empty stdout
- [ ] Doctor empty-target: `result: "degraded"`, exit 1,
      `INSTALL_MISSING` diagnostic; live installed target still `ok`/0
- [ ] All existing tests pass (64 node + 29 bun baseline + new tests)
- [ ] `pnpm run build` and `pnpm run verify:pack` green
- [ ] Version `0.1.1` in `package.json`; `manifest.json` regenerated
      with matching version
- [ ] Success summary line on install/update
- [ ] Working tree clean (`.atl/` excepted)
- [ ] `plans/README.md` row 009 → DONE

## STOP conditions

- Shim test stays red after two realpath-based attempts → report the
  failing assertion; fallback idea is a basename comparison
  (`argv[1]?.endsWith("install.mjs")`) but do not switch without
  approval.
- Existing suite regresses → stop, report the failing assertion, do
  not weaken tests.
- Doctor fix requires a schema change → schema is frozen; report
  instead.
- Step 6 publish instructions arrive without an explicit owner go →
  refuse and report.

## Maintenance notes

- The bin-shim guard is now realpath-based. If `install.mjs` is ever
  renamed or moved within the package, the shim test must still pass
  (it symlinks the absolute path — robust to renames).
- `INSTALL_MISSING` is a new diagnostic code in the schema v1
  contract. Adding codes is allowed; renaming is not. Plan 006
  compliance preserved.
- The success summary line is part of the UX contract going forward;
  any test that asserts silence on install/update must be updated.
