# Plan 002: Add the planning and review workflow

> **Executor instructions**: Complete Plan 001 first. Keep this phase entirely
> Markdown-based. Commands may instruct Sisyphus to delegate, but must not claim
> that command text itself executes agents or enforces completion.
>
> **Drift check**: Confirm Plan 001 files exist and the in-scope Phase 2 files do
> not. Stop if existing Phase 2 files contain unrelated work.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: `plans/001-core-agent-roster.md`
- **Category**: direction
- **Planned at**: unversioned greenfield directory, 2026-09-06

## Why this matters

Planning quality improves when discovery, gap analysis, and adversarial review
are separate responsibilities. This phase adapts OmO's Prometheus, Metis, and
Momus pipeline into portable OpenCode prompts and commands without pretending
to reproduce OmO's hooks or runtime model router.

## Scope

**In scope**:
- `.opencode/agent/librarian.md`
- `.opencode/agent/metis.md`
- `.opencode/agent/momus.md`
- `.opencode/command/plan.md`
- `.opencode/command/review-plan.md`
- `.opencode/command/ultrawork.md`
- `docs/inspiration-map.md`
- `README.md`

**Out of scope**:
- Plugins, runtime hooks, automatic model fallback, Team Mode
- Writing secrets or credentials to notepads

## Steps

### Step 1: Add the review specialists

Create `librarian` for read-only documentation and external-source research.
Create `metis` for requirement gaps, hidden assumptions, missing dependencies,
and unverifiable acceptance criteria. Create `momus` as a blocker-focused plan
refuter that rejects only evidence-backed defects. All three are subagents and
must deny edits, shell execution, and task delegation.

### Step 2: Add the planning commands

Create `/plan` targeting Sisyphus. It must accept `$ARGUMENTS`, gather evidence,
delegate a draft to Prometheus, ask the user only about unresolved owner
decisions, run Metis, then run Oracle and Momus independently. It returns the
plan only after blockers are resolved or clearly reports why planning stopped.

Create `/review-plan` targeting Sisyphus. It accepts a plan path or pasted plan,
runs Metis and Momus with distinct review scopes, validates findings against
repository evidence, and returns blocker/important/advisory findings.

Create `/ultrawork` targeting Sisyphus. It accepts `$ARGUMENTS`, establishes a
bounded goal, creates explicit todos, delegates by role, verifies results, and
stops on completion or a concrete blocker. It must not claim to provide OmO's
hook-enforced autonomous loop.

### Step 3: Define durable working notes

Commands should use `.agents/notepads/<sanitized-goal>/` only when durable
context adds value. Define `goal.md`, `findings.md`, `plan.md`, and `status.md`.
State that these are working notes, not canonical product documentation, and
must never contain credentials, tokens, or copied secret values.

### Step 4: Document provenance

Create `docs/inspiration-map.md` mapping each adopted, adapted, and excluded OmO
idea to this implementation. Link the upstream repository and identify this as
an independent implementation. Update the README with commands and notepads.

## Verification

```bash
for file in librarian metis momus; do test -f ".opencode/agent/$file.md"; done
for file in plan review-plan ultrawork; do test -f ".opencode/command/$file.md"; done
rg '\$ARGUMENTS' .opencode/command/{plan,review-plan,ultrawork}.md
rg -n 'edit: deny|bash: deny|task: deny' .opencode/agent/{librarian,metis,momus}.md
test -f docs/inspiration-map.md
```

Expected: all commands exit 0 and each command contains `$ARGUMENTS`.

## Done criteria

- [ ] Three read-only specialist agents exist with non-overlapping scopes.
- [ ] Three commands document inputs, outputs, STOP conditions, and honesty limits.
- [ ] Notepad lifecycle and secret-handling rules are explicit.
- [ ] The inspiration map distinguishes ported, adapted, and excluded features.
- [ ] `plans/README.md` marks Plan 002 `DONE`.

## STOP conditions

- Plan 001 is absent or incomplete.
- A command needs custom runtime tools to satisfy its documented contract.
- A proposed behavior can only be truthful with a lifecycle hook; defer it to
  Plan 003 rather than promising it here.
