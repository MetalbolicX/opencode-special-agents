---
description: Review an existing plan using Metis and Momus with distinct scopes and evidence validation.
agent: sisyphus
---

# `/review-plan` — Plan Review with Distinct Specialist Scopes

Invoke this command when a plan exists and needs structured adversarial review before implementation begins.

## Inputs

- `$ARGUMENTS` — either a path to a plan file (relative to the repository root) or a plan pasted inline. If `$ARGUMENTS` is empty, ask the user to provide the plan path or content.

## What this command does

1. **Load the plan** — read the plan file or parse the provided content. If a path is given, confirm the file exists before proceeding.
2. **Run Metis** — pass the plan to Metis asking for: missing dependencies, hidden assumptions, unverifiable acceptance criteria, incomplete scope, and contradictions. Metis focuses on what is absent or broken.
3. **Run Momus** — pass the same plan to Momus asking for evidence-backed blockers only. Momus does not offer alternatives; it refutes what cannot work.
4. **Validate findings against repository evidence** — before reporting any finding, check whether existing code, configuration, or git history substantiates it. Discard findings that cannot be evidenced.
5. **Return categorized findings** — present findings grouped as: **Blockers** (must resolve before proceeding), **Important** (high risk if ignored), **Advisory** (worth noting but not blocking).

## Outputs

- A structured review report listing each finding with:
  - Its category (blocker / important / advisory).
  - The specific plan claim or omission it targets.
  - The evidence supporting the finding.
  - A suggested resolution or clarification.
- If no blockers are found, state that explicitly.

## STOP conditions

- The plan cannot be loaded (file missing or content empty).
- The user has not provided a plan.
- The user explicitly asks to stop.

## Markdown does not enforce execution

This command file is Markdown — text that describes intended behavior. It does not mechanically run agents, enforce delegation, or guarantee completion. The described workflow is executed only when Sisyphus (or the orchestrator) explicitly invokes Metis and Momus in the described sequence.

## Safe notepad use

If the review generates findings that need to persist across sessions or be shared with other agents, Sisyphus may use `.agents/notepads/<sanitized-goal>/` with:
- `goal.md` — the goal the plan was meant to address.
- `findings.md` — the Metis and Momus findings, categorized and evidenced.
- `plan.md` — a copy of or link to the reviewed plan.
- `status.md` — current blocker status and which findings remain unresolved.

These are working notes, not canonical product documentation. **Never write credentials, tokens, or secret values to any notepad file.**
