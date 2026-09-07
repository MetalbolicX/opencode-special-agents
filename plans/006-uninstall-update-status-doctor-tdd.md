# Plan 006: Implement uninstall, update, status, and doctor with strict TDD

> **Executor instructions**: STRICT TDD, same discipline as Plan 005:
> red test → green implementation → refactor, one commit per cluster.
> Complete Plan 005 first; this plan reuses its helpers, fixtures, and state
> schema. If a STOP condition fires, stop and report.
>
> **Drift check**: `git diff --stat <005-final-commit>..HEAD -- install.mjs tests/`

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: MED
- **Depends on**: `plans/005-install-transaction-tdd.md`
- **Category**: dx
- **Planned at**: commit created by Plan 005 completion, 2026-09-06
- **Method**: strict TDD (node:test)

## Why this matters

Uninstall is where installers destroy user data. The review (Metis/Oracle)
locked the safety model: delete ONLY installer-owned files proven by state
hashes; when state is missing or corrupt, REPORT, never heuristically delete.
`status`/`doctor` make drift and duplicate installs visible — the cost of
copy-only distribution is exactly this visibility, so it must be first-class.

## Current state

- `install.mjs` exists with: arg parsing (no uninstall/update/status/doctor
  commands yet), source/target resolution, integrity check, plan/apply
  transaction, state file v1 written last, conflict keep policy, self-install
  guard, `--dry-run`.
- `tests/install.test.mjs` + `tests/helpers` + `tests/fixtures/payload` exist.
- State schema v1 lives at `<target>/.opencode-special-agents.json` (see
  Plan 005's normative contract — treat it as frozen).
- Exit-code convention so far: 0 success/no-op, 2 error/abort.

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| All installer tests | `node --test tests/install.test.mjs tests/cli-extra.test.mjs` | all pass |
| Full regression | `pnpm run build && node --test && bun test tests/continuation-state.test.ts` | green |

## Scope

**In scope**:
- `install.mjs` (extend: `uninstall`, `update`, `status`, `doctor`,
  `--json`, `--purge`, `--force`, `--gitignore-state`)
- `tests/cli-extra.test.mjs` (new)
- `tests/fixtures/**` additions (corrupt state, duplicate-scope, drift)
- `package.json` scripts updates

**Out of scope**:
- `postinstall`, `prepack`, `files[]`, npm publishing, README rewrite
  (Plan 007)
- Interactive TUI of any kind; model/provider anything

## Git workflow

- One commit per green cluster, conventional style, e.g.
  `feat(uninstall): remove only state-proven installer-owned files`.
- Tests ship with the behavior in the same commit.

## Steps (TDD clusters)

### Step 1: uninstall — the safety core

RED tests (spawn, tmpdir fixtures with a completed install):
1. Happy path: every state-listed file whose CURRENT on-disk sha equals the
   state sha is deleted; state file itself deleted; directories left empty
   (`agent/`, `command/`, `plugin/`) are pruned; unrelated files in target
   survive byte-identical.
2. User-modified file (on-disk sha ≠ state sha): file KEPT, stdout warns
   `KEPT (user-modified): <dest>`, exit code 1 (incomplete uninstall).
3. State missing entirely: REPORT-ONLY — list candidate files that match
   manifest `dest` names present in target, print how to recover
   (reinstall then uninstall), delete NOTHING, exit 1.
4. State corrupt (invalid JSON): same report-only behavior, exit 1.
5. `--force`: with valid state, ALSO delete user-modified installer-owned
   files (after backing them up like Plan 005 backups). Without state,
   `--force` still refuses (report-only is absolute).
GREEN: implement `runUninstall()`.

### Step 2: `--purge` semantics

RED: after uninstall, `.opencode-special-agents.backups/` and any
`.staging-*` dirs remain; `uninstall --purge` removes state backups and
staging dirs; nothing else beyond Step 1 removals; purge never touches
`node_modules` or files not created by this installer.
GREEN: extend uninstall with purge list.

### Step 3: update = hash-based reinstall

RED tests:
1. Payload fixture bump (change one agent's bytes + manifest sha + version) →
   `update` rewrites exactly that file, others untouched, state version
   bumped, report line per file: `updated | kept | unchanged`.
2. Same version but changed hash (republish scenario) → files STILL update
   (hash comparison, not version comparison).
3. User-modified target file + `--yes` → `kept`, reported as partial update,
   exit 1 with summary `update complete with 1 kept conflict`.
GREEN: implement `runUpdate()` as install pipeline + per-file disposition
report (reuse Plan 005 internals; update is an alias of install with
reporting — do not fork the code path).

### Step 4: status (human + machine)

RED tests:
1. Text mode: per file one of `installed | missing | modified | kept`
   (kept = state disposition kept from a past conflict); header with target,
   scope, manifest version, state version; exit 0 always on success.
2. `--json` mode: EXACT schema below (deep-equal test); exit 0.
GREEN: implement `runStatus()`.

**Normative contract — JSON output schema v1** (status and doctor share it):

```json
{
  "schemaVersion": 1,
  "command": "status|doctor",
  "target": "<abs dir>",
  "scope": "project|global",
  "version": {"manifest": "<v>", "installed": "<v|null>"},
  "pluginEnabled": true,
  "files": [{"dest": "agent/sisyphus.md", "state": "installed|missing|modified|kept"}],
  "diagnostics": [{"level": "info|warn|error", "code": "<stable-code>", "message": "..."}],
  "result": "ok|degraded|failed"
}
```

### Step 5: doctor

RED tests (fixture-driven):
1. Clean install → exit 0, `result: "ok"`, empty diagnostics.
2. Tampered installed file (sha mismatch) → exit 1, `result: "degraded"`,
   diagnostic code `FILE_DRIFT`.
3. Duplicate installs: `--root` fixtures for BOTH project and global targets
   present → exit 1, diagnostic `DUPLICATE_SCOPE` (warning), message notes
   project scope takes precedence for overlapping files (verify wording says
   "project-local files shadow global" as the documented expectation).
4. Missing dist artifact in source → exit 2, `result: "failed"`,
   `PAYLOAD_INVALID` (re-run build).
5. Unwritable target dir → exit 2, `TARGET_UNWRITABLE`.
6. `--json` mode emits the schema above with doctor's diagnostics.
GREEN: implement `runDoctor()` reusing verifyPayload/status internals.

### Step 6: `--gitignore-state` offer (explicit, never automatic)

RED tests:
1. `install --gitignore-state` (project scope): appends the managed line
   `.opencode-special-agents.json` to `<project>/.opencode/.gitignore`,
   creating the file if absent; idempotent (second run adds no duplicate).
2. Global scope: flag rejected with usage error (state gitignore is a
   project-only concern).
3. Default (no flag): `.gitignore` NEVER touched, even when missing.
GREEN: implement as install-time optional step (before state write).

### Step 7: USAGE + full regression

Extend usage text and its test (Plan 005 Step 1 pattern) with every new
command and flag. Full suite green; bump `test:installer` to include the new
test file.

## Test plan

New file `tests/cli-extra.test.mjs`; reuse `tests/helpers` fixtures. Matrix:

| Behavior | Level |
|---|---|
| uninstall happy path + pruning + survivors | spawn |
| uninstall keeps user-modified, exit 1 | spawn |
| state missing/corrupt → report-only, no deletion | spawn |
| `--force` deletes modified (with backup), still report-only without state | spawn |
| `--purge` removes backups+staging only | spawn |
| update by hash (version-same-hash-changed) | spawn |
| update partial (kept conflict) summary + exit 1 | spawn |
| status text + `--json` deep-equal schema v1 | spawn |
| doctor clean/drift/duplicate/invalid-payload/unwritable → 0/1/2 | spawn |
| `--gitignore-state` on/off/global-reject/idempotent | spawn |
| usage covers all commands+flags | spawn |

## Done criteria

- [ ] `node --test` runs BOTH installer test files green with red-first history
- [ ] Report-only uninstall proven: zero deletions without valid state
- [ ] Update proven hash-based, partial updates visible, exit codes correct
- [ ] `status --json` and `doctor --json` deep-equal schema v1
- [ ] Doctor exit codes 0/1/2 stable across fixtures
- [ ] Zero third-party imports in install.mjs (grep check)
- [ ] No out-of-scope file modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

- Plan 005 internals prove inadequate for reuse (report the concrete
  function; do not fork the transaction logic silently).
- Any test requires deleting outside `os.tmpdir()` — redesign the fixture,
  never relax isolation.
- A behavior conflicts with state schema v1 — schema is frozen in this plan;
  report instead of bumping schemaVersion.

## Maintenance notes

- Diagnostic codes (`FILE_DRIFT`, `DUPLICATE_SCOPE`, …) are a public
  interface for scripting; add codes, never rename existing ones.
- `update` must remain an alias of the install pipeline — divergence here is
  the classic installer bug source.
