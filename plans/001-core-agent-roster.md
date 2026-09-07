# Plan 001: Create the core OpenCode agent roster

> **Executor instructions**: Follow every step in order. Do not add plugin code,
> commands, skills, package dependencies, or model IDs in this phase. Stop on a
> failed verification after two reasonable attempts.
>
> **Drift check**: This was planned in an empty, unversioned directory. Before
> starting, verify that none of the in-scope files below already exists. If one
> exists with content not created by this plan, stop and report the conflict.

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: unversioned greenfield directory, 2026-09-06

## Why this matters

The project needs portable OpenCode agents, not a partial copy of OmO's coupled
runtime. This phase establishes five roles with narrow ownership and native
permissions. It preserves the strongest OmO idea, specialist delegation, while
remaining model- and provider-agnostic.

## Current state

The workspace contains no implementation. OpenCode loads project agents from
`.opencode/agent/*.md`. The Markdown body is the prompt; supported frontmatter
includes `description`, `mode`, `model`, `permission`, and tool configuration.
Omit `model` so the user's global provider policy remains authoritative.

## Scope

**In scope**:
- `README.md`
- `.opencode/agent/sisyphus.md`
- `.opencode/agent/hephaestus.md`
- `.opencode/agent/prometheus.md`
- `.opencode/agent/oracle.md`
- `.opencode/agent/scout.md`

**Out of scope**:
- Commands, plugins, package manifests, tests, MCP servers, and model IDs
- Claims that prompts mechanically guarantee completion

## Steps

### Step 1: Define the delivery roles

Create `sisyphus` as the primary orchestrator. It owns intent clarification,
work decomposition, delegation, verification, and the final answer. Its prompt
must use the cheapest adequate worker, run independent work in parallel, keep
one active todo, and never delegate without explicit acceptance criteria.

Create `hephaestus` as a subagent for autonomous implementation and difficult
single-system debugging. It receives a goal and acceptance criteria, explores
before editing, verifies its own changes, and cannot delegate further.

Create `prometheus` as a read-only subagent that interviews only for decisions
that evidence cannot resolve, then returns a self-contained executable plan.
It must not implement or modify files.

### Step 2: Define read-only evidence roles

Create `oracle` as a read-only architecture, security, and tradeoff advisor.
Create `scout` as a fast read-only repository explorer. Both must deny edits,
shell execution, and task delegation through frontmatter permissions. Oracle
returns a recommendation with tradeoffs; Scout returns evidence with file and
line references rather than broad recommendations.

### Step 3: Document installation and honesty boundaries

Create `README.md` with purpose, installation for project and global scopes,
agent invocation examples, the role table, and the distinction between prompt
contracts and OpenCode-enforced permissions. State that users must restart
OpenCode after installing or changing agents.

## Verification

Run:

```bash
test -f README.md
for file in sisyphus hephaestus prometheus oracle scout; do test -f ".opencode/agent/$file.md"; done
rg -L '^---$' .opencode/agent/*.md
rg '^model:' .opencode/agent && exit 1 || true
```

Expected: every command exits 0; no agent contains a `model:` field.

Inspect read-only roles:

```bash
rg -n 'edit: deny|bash: deny|task: deny' .opencode/agent/{prometheus,oracle,scout}.md
```

Expected: all three files deny edit, bash, and task permissions.

## Done criteria

- [ ] Five valid agent files exist with distinct responsibilities.
- [ ] No provider or model is hardcoded.
- [ ] Prometheus, Oracle, and Scout are natively read-only.
- [ ] Hephaestus cannot delegate.
- [ ] README documents restart, installation, and enforcement limits.
- [ ] `plans/README.md` marks Plan 001 `DONE`.

## STOP conditions

- An in-scope file already contains unrelated user work.
- A required permission field is rejected by the installed OpenCode version.
- The implementation would require plugin code or a package dependency.
