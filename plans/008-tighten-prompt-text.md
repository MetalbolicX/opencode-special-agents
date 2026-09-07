# Plan 008: Tighten agent and command prompt text (anti-hallucination)

> **Executor instructions**: Rewrite the prompt text of the 8 agent and 3
> command Markdown files per the per-file changes below. Preserve frontmatter
> structure, persona names, and voice; replace ambiguity with testable
> directives. After rewriting, run every gate in "Mechanical steps". Update
> the status row in `plans/README.md`.
>
> **Method**: verification-gated rewrite (prompt text is not TDD-able; every
> change is enforced by a machine-checkable gate: grep bans, manifest regen,
> test suites, agent discovery).
>
> **Drift check**: these files are manifest payload — after ANY edit,
> `pnpm run gen:manifest` must run and the updated `manifest.json` must be
> committed (Plan 004 maintenance contract).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (semantic contract changes; agent discovery gate protects)
- **Depends on**: none hard (reuses Plan 004 tooling for manifest regen)
- **Category**: dx
- **Planned at**: post `5bfe67d`, 2026-09-07
- **Method**: verification-gated rewrite
- **Approved**: owner chose Option A (semantic fixes included)

## Why this matters

A text audit found instructions that demand behavior agents cannot perform.
Models resolve unsatisfiable instructions by fabricating — the exact failure
this suite exists to prevent. Five direct hallucination inducers:

| File:line | Defect |
|---|---|
| `oracle.md:28` | "with citations" — `bash: deny`, no retrieval → fabricated references |
| `scout.md:33` | "always verify the execution path" — read-only agent cannot execute → claimed-but-unperformed verification |
| `prometheus.md:15,21` | "interview the user" — subagents have no user channel → simulated answers |
| `librarian.md:23` | External URLs required, no retrieval tool → fabricated URLs |
| `momus.md:22` | Judging "legal" feasibility with zero evidence source |

Four hard contradictions:

1. `sisyphus.md:32` one-todo rule vs `ultrawork.md:17` / `plan.md` multi-todo pipelines
2. `hephaestus.md:29` "hypothesise before looking at code" vs `:38` "never guess without evidence"
3. `review-plan.md:28` requires resolutions per finding vs `momus.md:20` forbids alternatives
4. `prometheus.md` interviews user vs `plan.md:18` orchestrator relays — three-way relay inconsistency

Undefined vocabulary: "cheapest adequate worker" (sisyphus:29), severity
levels (metis:34), "too large" (ultrawork:12), non-resolution (plan:31),
"evidence" (hephaestus:25), the Metis/Momus boundary (review-plan:17-18 only).

## Design rules (apply uniformly)

1. **No instruction without a mechanism**: every directive names the tool or
   permission that performs it. If the agent cannot do it, remove or rescope.
2. **Unified evidence standard**: claims cite `file:line`; verification cites
   a named command + exit code; "I don't know" / "ambiguous" is always a
   valid report item (Scout's model, extended suite-wide).
3. **Defined vocabulary**: every subjective term gets a testable criterion.
4. **Imperative voice only**: no hedging ("consider", "where appropriate",
   "try to").
5. **Frontmatter is sacred**: keep `mode`, `permission` blocks, and
   `agent:` bindings exactly as-is. `description` text may be tightened
   (e.g. drop Scout's "Fast") but must keep its meaning.

## Canonical texts (embed VERBATIM where indicated)

**TODO DISCIPLINE** — sisyphus.md, ultrawork.md, plan.md:
> Todo discipline: keep exactly one in-progress todo per delegated unit.
> Command workflows that define a todo pipeline may keep an ordered list;
> advance items sequentially, never two in parallel.

**METIS/MOMUS BOUNDARY** — metis.md, momus.md, review-plan.md:
> Boundary: Metis finds what is missing or contradictory inside the plan
> (gaps, undefined terms, unverifiable criteria). Momus attacks a complete
> plan that cannot work as written (mechanisms that break). Metis does not
> judge feasibility; Momus does not report gaps.

**SEVERITY DEFINITIONS** — metis.md:
> Blocker: the plan cannot start or complete as written. Important: it
> completes but violates a stated requirement or contract. Advisory:
> anything else.

**PROMETHEUS RELAY** — prometheus.md and plan.md (each side of the contract):
> (prometheus.md) If evidence cannot resolve a decision, list the open
> questions under a `## Questions` heading in your report. Do not answer
> them yourself. The orchestrator relays them to the user.
> (plan.md) If Prometheus's report has a `## Questions` section, present
> exactly those questions to the user and wait.

**ROUTING TABLE** — sisyphus.md, ultrawork.md (mirror of ultrawork:18-22):
> Route by role: read-only reconnaissance → Scout; documentation and
> external-source needs → Librarian; planning and interviews of evidence →
> Prometheus; gap and consistency analysis → Metis; adversarial refutation →
> Momus; tradeoff and security advisory → Oracle; implementation and
> debugging → Hephaestus.

**ACCEPTANCE** — sisyphus.md:
> A delegated unit is accepted when its DoD checks pass or the user confirms
> the result. Silence is not acceptance.

## Scope

**In scope**: `.opencode/agent/*.md` (8), `.opencode/command/*.md` (3),
`manifest.json` (regenerated), `plans/README.md` (status row), this file.

**Out of scope**: `.opencode/plugin/`, `.opencode/lib/`, `install.mjs`,
`tests/`, `README.md` (root), `scripts/`, CI, publishing.

## Git workflow

2–4 conventional commits, e.g.:
- `docs(agents): replace unsatisfiable directives with grounded ones`
- `docs(commands): resolve relay, todo, and reviewer-boundary contradictions`
- `chore: regenerate manifest after prompt-text rewrite`

## Steps

### Step 1: Agent files

- **sisyphus.md**: L29 → ROUTING TABLE; L32 → TODO DISCIPLINE; L26 →
  ACCEPTANCE; add edit-vs-delegate boundary: Sisyphus edits only trivial
  fixes (typos, config values); all real implementation goes to Hephaestus.
- **hephaestus.md**: L29 → "Read the failing code first, then form ONE
  root-cause hypothesis, then validate it against evidence before editing."
  L25 → "Report the passing test command with its exit code and reference
  changed files as `path:line`." L36 → "Never invoke subagents."
- **prometheus.md**: L15,21-24 → PROMETHEUS RELAY. Resolve depth tension:
  "Each step names the files it touches and the verification command to run;
  include no code snippets."
- **oracle.md**: L28 → "Ground each recommendation in the tradeoff table
  itself; if you cannot name the mechanism, say so explicitly — never invent
  citations." L25 → scoped criterion: authorization, injection,
  secrets-in-logs, privilege boundaries, dependency trust.
- **scout.md**: L33 → "Verify by static reading: trace the call path and
  cite `file:line` for every hop; when control flow is ambiguous (dynamic
  dispatch), report the ambiguity instead of asserting behavior."
  Description: drop "Fast".
- **librarian.md**: L23 → "Return paths into the repository's own docs. For
  external sources, state that an external lookup is needed and what query
  would answer it — never fabricate URLs." Deduplicate the synthesize-bans.
- **metis.md**: add SEVERITY DEFINITIONS; add METIS/MOMUS BOUNDARY; drop the
  suggested-next-step leak into Prometheus's job or keep only as "frame as a
  question for Prometheus".
- **momus.md**: L22 → "technical or resource constraints that make the plan
  fail, each backed by a cited mechanism" (drop "legal"); add METIS/MOMUS
  BOUNDARY.

### Step 2: Command files

- **ultrawork.md**: L17 → TODO DISCIPLINE reference; L28 → "This command
  does not create an autonomous loop; execution ends when todos complete or
  a STOP condition fires." L12 → replace "too large" with: "if the goal
  needs more than one delegation round per todo, ask the user to narrow
  scope." Keep the routing table and mirror it into sisyphus.md.
- **plan.md**: step 3 → PROMETHEUS RELAY (orchestrator side); L31 → "the
  user explicitly declines, or two relay rounds pass without an answer";
  L41 → sanitization rule: `[a-z0-9-]` only, spaces → hyphens, max 40
  chars, directory created on first use; consolidate the disclaimer to one
  line.
- **review-plan.md**: L28 → "Momus findings carry no resolutions; route
  resolution requests to Oracle." L17-18 → METIS/MOMUS BOUNDARY; L19 →
  "When validation contradicts a reviewer finding, report the contradiction
  to the user; do not silently discard either side." Consolidate disclaimer.

### Step 3: Mechanical gates (all must pass)

```
pnpm run gen:manifest
pnpm test                      # 73 node + 29 bun
pnpm run verify:pack
opencode agent list            # all 8 agents discovered
grep -rn "cheapest adequate" .opencode/agent .opencode/command        # no match
grep -rn "interview the user" .opencode/agent .opencode/command       # no match
grep -rn "with citations" .opencode/agent                             # no match
grep -rn "OmO" .opencode/command                                      # no match
grep -rn "verify the execution path" .opencode/agent                  # no match
grep -rn "legal" .opencode/agent/momus.md                             # no match
```

### Step 4: Bookkeeping

Commit manifest regen; set `plans/README.md` row 008 → DONE.

## Done criteria

- [ ] All Step 3 gates green
- [ ] Zero banned phrases (grep table)
- [ ] Canonical texts appear verbatim in every indicated file
- [ ] Frontmatter unchanged except allowed description tightening
- [ ] Persona names and voice preserved — flavor stays, ambiguity goes
- [ ] `manifest.json` regenerated and committed
- [ ] Working tree clean (`.atl/` excepted)

## STOP conditions

- `opencode agent list` fails to discover any agent after the rewrite
  (frontmatter broken) and two fix attempts fail.
- Any test suite regresses below its baseline (73 node / 29 bun).
- A gate grep cannot be made to pass without removing a required behavior —
  report instead of deleting semantics.

## Maintenance notes

- Prompt-text edits are payload edits: always regenerate the manifest and
  commit it in the same change.
- Canonical texts above are single-source-of-truth snippets: if one changes,
  change every file that embeds it, in the same commit.
- New agent instructions must pass Design rule 1 (mechanism named) before
  merging — the grep gate list should grow with them.
