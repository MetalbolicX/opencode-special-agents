# Plan 003: Add bounded idle continuation

> **Executor instructions**: Complete Plans 001 and 002 first. This plugin is a
> narrow enforcement layer, not an autonomous loop. Use the current OpenCode v1
> plugin SDK calls named below. Stop if the installed SDK surface differs.
>
> **Drift check**: Verify the Phase 3 files do not already exist. Stop on any
> unrelated content conflict.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: `plans/001-core-agent-roster.md`, `plans/002-planning-review-workflow.md`
- **Category**: dx
- **Planned at**: unversioned greenfield directory, 2026-09-06

## Why this matters

Prompts cannot observe `session.idle`, so they cannot mechanically resume an
agent that stops with unfinished todos. This optional plugin provides one safe
nudge while bounding cost and preventing infinite idle loops. It intentionally
does less than OmO's persistent Todo Enforcer.

## Current API contract

- Project plugins auto-load from `.opencode/plugin/*.ts`.
- Listen through `event: async ({ event })`; v1 idle events use
  `event.type === "session.idle"` and `event.properties.sessionID`.
- Read todos with `client.session.todo({ path: { id: sessionID } })`.
- Queue without blocking the event pump using
  `client.session.promptAsync({ path: { sessionID }, body: { parts } })`.
- SDK calls return an envelope that may contain `error`; do not assume errors
  are thrown.

## Scope

**In scope**:
- `.opencode/plugin/continuation-enforcer.ts`
- `.opencode/lib/continuation-state.ts`
- `tests/continuation-state.test.ts`
- `README.md`

**Out of scope**:
- Persistent state, more than one automatic nudge, model selection, Team Mode
- Triggering on events other than `session.idle`
- Continuing when todo retrieval fails or returns no actionable todos

## Steps

### Step 1: Implement deterministic guard state

In `.opencode/lib/continuation-state.ts`, implement pure functions and types for:
- actionable todo statuses: exactly `pending` and `in_progress`;
- a stable fingerprint from actionable todo content, status, and priority;
- a per-session state containing continuation count, last fingerprint, and an
  in-flight flag;
- a decision that permits at most one nudge and rejects empty, unchanged,
  already-in-flight, or exhausted states.

### Step 2: Implement the idle hook

Create a default-exported `Plugin` in
`.opencode/plugin/continuation-enforcer.ts`. On `session.idle` only:
1. Ignore sessions whose synthetic continuation is already in flight, clearing
   that flag so the resulting idle event cannot queue another prompt.
2. Fetch todos for that session and return safely on missing data or `error`.
3. Evaluate the pure guard and reserve state before calling `promptAsync`.
4. Queue a neutral message telling the current session to resume only if the
   remaining todo is still valid; otherwise summarize its blocker and stop.
5. On prompt queue failure, clear in-flight state but retain the consumed
   fingerprint/count so a noisy idle loop does not retry automatically.

Keep all state in memory and keyed by session ID.

### Step 3: Test loop safety

Using `bun:test`, cover:
- no nudge for no todos;
- pending and in-progress todos are actionable;
- completed/cancelled todos are not actionable;
- stable fingerprints do not depend on todo ordering;
- first actionable idle is allowed;
- in-flight, identical-state, and cap-exhausted decisions are denied.

### Step 4: Document opt-in behavior

Update README: plugin presence enables one-nudge continuation after restart;
removing `.opencode/plugin/continuation-enforcer.ts` disables it. State the one
nudge cap, session-local in-memory state, cost implication, and failure-safe
behavior.

## Verification

```bash
bun test tests/continuation-state.test.ts
bun build .opencode/plugin/continuation-enforcer.ts --target=bun --outfile=/tmp/continuation-enforcer.js
rg -n 'session\.idle|properties\.sessionID|session\.todo|promptAsync' .opencode/plugin/continuation-enforcer.ts
```

Expected: tests pass, build exits 0, and all four API markers are present.

## Done criteria

- [ ] Plugin reacts only to `session.idle` and prompts only the same session.
- [ ] It continues only when actionable todos exist.
- [ ] In-flight, fingerprint, and one-nudge guards are tested.
- [ ] Todo or prompt API errors fail closed.
- [ ] README documents enablement, removal, limits, and restart.
- [ ] `plans/README.md` marks Plan 003 `DONE`.

## STOP conditions

- The installed plugin event shape lacks `event.properties.sessionID`.
- `client.session.todo` or `client.session.promptAsync` does not exist.
- Tests require installing dependencies into the repository.
- Loop safety would require persistent state or more than one automatic nudge.
