---
description: Execute a bounded goal with explicit todos, role-based delegation, and verification — stopping on completion or concrete blockers.
agent: sisyphus
---

# `/ultrawork` — Bounded Goal Execution with Explicit Delegation

Invoke this command when a bounded goal with clear acceptance criteria is ready for execution and needs structured delegation, verification, and explicit stopping.

## Inputs

- `$ARGUMENTS` — the goal to execute. Should be a specific, bounded task (e.g., "implement feature X", "fix bug Y", "add tests for Z"). If the goal needs more than one delegation round per todo, ask the user to narrow scope.

## What this command does

1. **Establish the bounded goal** — confirm the exact deliverable and what "done" means. Ask the user to specify acceptance criteria if none are provided.
2. **Create explicit todos** — break the goal into concrete, ordered todos. Each todo must have a single clear deliverable.

   Todo discipline: keep exactly one in-progress todo per delegated unit.
   Command workflows that define a todo pipeline may keep an ordered list;
   advance items sequentially, never two in parallel.
3. **Delegate by role** — assign each todo to the appropriate specialist:
   Route by role: read-only reconnaissance → Scout; documentation and external-source needs → Librarian; planning and interviews of evidence → Prometheus; gap and consistency analysis → Metis; adversarial refutation → Momus; tradeoff and security advisory → Oracle; implementation and debugging → Hephaestus.
4. **Verify results** — before marking a todo complete, confirm the delegated agent's output meets the acceptance criteria for that step.
5. **Stop on completion or blocker** — when all todos are complete, report success with verification evidence. When a blocker is hit, report it with evidence, what was attempted, and what remains.

## What this command does not do

- This command does not create an autonomous loop; execution ends when todos complete or a STOP condition fires.
- It does not redelegate completed todos or retry failed ones automatically. Each stop is explicit and reported to the user.

## Outputs

- A todo list showing each step, the role that handled it, and its verified status.
- If blocked: the specific evidence-backed blocker, what was attempted, and what the user or orchestrator needs to decide.
- On completion: the verified deliverable and how it was confirmed.

## STOP conditions

- The goal is too broad to be bounded in one session — narrow it first.
- No acceptance criteria can be established.
- A todo produces a concrete blocker that cannot be resolved by the assigned role.
- The user explicitly asks to stop.

## Markdown does not enforce execution

This command file is Markdown — text that describes intended behavior. It does not mechanically run agents, enforce delegation, continue on idle, or guarantee completion. The described workflow is executed only when Sisyphus (or the orchestrator) explicitly invokes the named roles in the described sequence.

## Safe notepad use

For goals spanning multiple sessions, Sisyphus may use `.agents/notepads/<sanitized-goal>/` with:
- `goal.md` — the bounded goal and acceptance criteria.
- `findings.md` — evidence and findings gathered during execution.
- `plan.md` — the explicit todo list with role assignments.
- `status.md` — current status of each todo: pending, complete, or blocked.

These are working notes, not canonical product documentation. **Never write credentials, tokens, or secret values to any notepad file.**
