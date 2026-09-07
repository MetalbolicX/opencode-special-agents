# Inspiration Map

This document maps ideas from [oh-my-openagent (OmO)](https://github.com/code-yeongyu/oh-my-openagent) to this implementation, distinguishing adopted, adapted, and excluded concepts. This is an **independent implementation** — it shares behavioral inspiration with OmO but does not use OmO's TypeScript agent factories, runtime packages, or plugin hooks.

---

## Adopted ideas

These ideas are used directly, mapped to OpenCode's native agent model with equivalent behavior.

### Specialist delegation model

**OmO**: Each agent (Prometheus, Metis, Momus, etc.) is a distinct role with a specific scope. The orchestrator delegates to each role rather than running everything itself.

**This implementation**: Five Phase 1 specialists (Sisyphus, Hephaestus, Prometheus, Oracle, Scout) and three Phase 2 specialists (Librarian, Metis, Momus) are defined as native OpenCode subagents with narrow scopes. Sisyphus acts as the orchestrator.

**Why adapted**: OpenCode agents are Markdown files with frontmatter permissions rather than TypeScript classes. Specialist scope is expressed in the prompt body and enforced through `permission.edit`, `permission.bash`, and `permission.task` fields rather than runtime role checks.

### Read-only evidence roles

**OmO**: Prometheus interviews for unresolved decisions; Oracle advises on architecture; Scout explores the repository.

**This implementation**: Prometheus, Oracle, Scout, Librarian, Metis, and Momus all deny edit, bash, and task permissions. They return structured findings, not edits.

**Why adapted**: OpenCode's native permission fields enforce read-only behavior directly, without needing OmO's `baseAgent` factory or tool-filtering logic.

---

## Adapted ideas

These ideas come from OmO's design but are restructured to fit OpenCode's prompt-based agent model.

### Prometheus / Metis / Momus pipeline

**OmO**: The planning pipeline runs Prometheus (decisions), Metis (gaps), and Momus (blockers) as a sequential or parallel review layer before a plan is accepted.

**This implementation**: The `/plan` command runs Prometheus to draft, then Metis to find gaps, then Oracle and Momus in parallel for architecture review and blocker refutation. The `/review-plan` command runs Metis and Momus with distinct review scopes on an existing plan.

**Why adapted**: OmO's pipeline runs as an internal agent orchestration loop. Here it is expressed as a command that instructs Sisyphus to invoke the specialists in sequence. The pipeline is a documented delegation pattern, not a runtime hook.

### Planning command with blocker resolution

**OmO**: Prompts include conditional logic to stop or continue based on subagent responses.

**This implementation**: `/plan` documents explicit STOP conditions. If Metis surfaces a blocker or Momus surfaces a refutation, the command reports it and stops. The user decides whether to re-plan or abandon.

**Why adapted**: OpenCode Markdown cannot observe lifecycle events or branch execution. STOP conditions are documented commitments that Sisyphus is instructed to honor — they are behavioral contracts, not runtime gates.

### Bounded goal execution

**OmO**: Team Mode or autonomous loops allow an agent to continue working until a goal is reached or a hook fires.

**This implementation**: `/ultrawork` establishes an explicit bounded goal, creates numbered todos, delegates each to the appropriate role, verifies results, and stops on completion or a concrete blocker.

**Why adapted**: Without Plan 003's idle-continuation hook, there is no autonomous loop. `/ultrawork` is a structured delegation command, not an autonomous executor. Plan 003 (bounded idle continuation) adds a guarded `session.idle` reaction, but it is explicitly bounded and does not provide OmO's unconstrained autonomous loop.

---

## Excluded ideas

These OmO features are deliberately not implemented.

### Team Mode and `team_*` tools

OmO's Team Mode coordinates multiple agents with shared context and inter-agent messaging tools. This implementation uses a single orchestrator (Sisyphus) with explicit delegation, not a team messaging bus.

### Hash-anchored editing

OmO supports editing a file at a specific commit hash. This implementation does not use hash-anchored editing.

### LSP, AST-grep, tmux, and bundled MCP implementations

OmO includes language-server integration, AST-based search tools, tmux session management, and pre-built MCP servers. This implementation excludes all of these.

### Runtime model fallback chains

OmO can fall back to a different model if the primary one fails or times out. This implementation is model- and provider-agnostic by design — no `model` field is set in any agent or command frontmatter.

### Persistent autonomous continuation loops

OmO can continue executing indefinitely until a goal is met. Plan 003 adds bounded idle continuation (one guarded prompt on `session.idle`), but it does not replicate an unconstrained autonomous loop.

### TypeScript agent factories and runtime packages

OmO's agents are TypeScript classes instantiated by a runtime. This implementation uses Markdown files only — no npm packages, no TypeScript, no build step.

---

## Related reading

- OmO upstream: <https://github.com/code-yeongyu/oh-my-openagent>
- OpenCode agent documentation: <https://github.com/opencode-ai/opencode>
