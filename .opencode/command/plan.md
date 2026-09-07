---
description: Delegate structured planning to Sisyphus with evidence gathering, specialist reviews, and explicit blocker resolution.
agent: sisyphus
---

# `/plan` — Structured Planning with Blocker Resolution

Invoke this command when a user needs a structured plan for a goal, feature, or refactor that requires multiple steps, role assignments, or specialist analysis.

## Inputs

- `$ARGUMENTS` — the goal or intent to plan for. Accepts a short description or multi-paragraph brief. If empty, ask the user to clarify the goal before proceeding.

## What this command does

1. **Gather evidence** — explore the repository to understand the current state relevant to the goal. Use Scout or Librarian to ground the plan in existing reality.
2. **Delegate a draft to Prometheus** — hand off the evidence and goal to Prometheus, asking for a structured plan with goal, prerequisites, steps, and verification criteria.
3. **Identify unresolved owner decisions** — if Prometheus returns questions, present only those to the user. Do not proceed past this step until the user answers them.
4. **Run Metis** — pass the draft plan to Metis and ask for blocker, important, and advisory findings.
5. **Run Oracle and Momus independently** — pass the plan to Oracle for architecture and tradeoff review, and to Momus for blocker refutation, in parallel.
6. **Resolve or report** — if blockers exist, report them clearly to the user and stop. If no blockers remain, return the finalized plan.

## Outputs

- A finalized plan with: **Goal**, **Prerequisites**, **Steps** (numbered, each with a deliverable), and **Verification** criteria.
- If planning stopped early: a clear report of what blocked resolution, what evidence was gathered, and what the user needs to decide.

## STOP conditions

- The user has not provided or clarified a goal.
- Metis surfaces a blocker and the user does not resolve it.
- Momus surfaces an evidence-backed refutation that cannot be re-planned around.
- The user explicitly asks to stop.

## Markdown does not enforce execution

This command file is Markdown — text that describes intended behavior. It does not mechanically run agents, enforce delegation, or guarantee completion. The described workflow is executed only when Sisyphus (or the orchestrator) explicitly invokes the named subagents in the described sequence.

## Safe notepad use

If durable working context is needed across long or multi-session planning, Sisyphus may use `.agents/notepads/<sanitized-goal>/` with:
- `goal.md` — the user's stated goal and any clarified decisions.
- `findings.md` — evidence gathered by Librarian, Metis, Oracle, and Momus.
- `plan.md` — the draft or finalized plan.
- `status.md` — current blocker state and next action.

These are working notes, not canonical product documentation. **Never write credentials, tokens, or secret values to any notepad file.**
