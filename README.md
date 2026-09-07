# OpenCode Agent Roster

A collection of specialist OpenCode agents inspired by OmO's delegation model but built as independent native Markdown agents. This project is OmO-inspired but does not use OmO's TypeScript agent factories, runtime packages, or plugin hooks. See `docs/inspiration-map.md` for a full provenance map.

## Agents

| Agent | Role | Permissions |
|---|---|---|
| **Sisyphus** | Primary orchestrator — intent clarification, work decomposition, delegation, verification | edit, bash, task |
| **Hephaestus** | Autonomous implementation and single-system debugging subagent | edit, bash |
| **Prometheus** | Read-only decision-planning subagent; interviews for unresolved decisions | read-only |
| **Oracle** | Read-only architecture, security, and tradeoff advisor | read-only |
| **Scout** | Fast read-only repository explorer; evidence with file/line references | read-only |
| **Librarian** | Read-only documentation and external-source research | read-only |
| **Metis** | Read-only requirement-gap, assumption, and acceptance-criteria analysis | read-only |
| **Momus** | Read-only blocker-focused plan refuter; challenges evidence-backed claims only | read-only |

## Prompt vs. Permission Boundaries

The Markdown prompt defines what an agent *should* do. OpenCode's frontmatter `permission` fields define what an agent *can* do — enforced natively, independent of the model.

- **Prompt contracts** describe intended behavior: how an agent reasons, what it returns, and what it avoids. A model following the prompt is responsible for those commitments.
- **Permission fields** (`edit`, `bash`, `task`) are enforced by OpenCode's runtime. Even if the prompt says "do not edit files," a model with `edit: allow` can do so.

Read-only agents (Prometheus, Oracle, Scout, Librarian, Metis, Momus) explicitly deny `edit`, `bash`, and `task` in frontmatter. Hephaestus denies `task` to prevent recursive delegation.

## Installation

### Install matrix

| Scope | Command |
|---|---|
| Project | `npx opencode-special-agents install` |
| Global | `npx opencode-special-agents install --scope global` |
| From checkout | `node install.mjs install` |

The installer places agent and command files into the target `.opencode/` directory and (by default) installs the continuation-enforcer plugin. The plugin is **enabled by default** — use `--plugin off` to skip it.

### Postinstall auto-install (opt-in)

Set the environment variable `OPENCODE_SPECIAL_AGENTS_AUTO_INSTALL=1` before `pnpm install` (or `npm install`) to automatically run the global installer after package installation. Without this variable, no automatic installation occurs — you always control when the installer runs.

## Commands

All commands are run via the `opencode-special-agents` binary (installed as `npx opencode-special-agents` or via the `install.mjs` entry point).

| Command | Description |
|---|---|
| `npx opencode-special-agents install` | Install or update agents, commands, and plugin (default: project scope) |
| `npx opencode-special-agents install --scope global` | Install globally — available to all projects |
| `npx opencode-special-agents install --plugin off` | Install without the continuation-enforcer plugin |
| `npx opencode-special-agents install --dry-run` | Show what would be installed without writing files |
| `npx opencode-special-agents install --yes` | Non-interactive: keep user-modified files on conflict |
| `npx opencode-special-agents install --gitignore-state` | Add the state file to `.opencode/.gitignore` |
| `npx opencode-special-agents install --allow-self-install` | Allow installing into the source's own `.opencode/` dir |
| `npx opencode-special-agents install --source <path>` | Override the source directory |
| `npx opencode-special-agents install --root <path>` | Override the target root directory |
| `npx opencode-special-agents uninstall` | Remove installed files (report-only without state file) |
| `npx opencode-special-agents uninstall --force` | Force delete user-modified files (with backup) |
| `npx opencode-special-agents uninstall --purge` | Also remove backups and stale staging dirs |
| `npx opencode-special-agents update` | Update to the latest version (hash-based, per-file reporting) |
| `npx opencode-special-agents status` | Show installed files and their state |
| `npx opencode-special-agents status --json` | JSON output for status |
| `npx opencode-special-agents doctor` | Diagnose installation health |
| `npx opencode-special-agents doctor --json` | JSON output for diagnostics |

## Plugin

The continuation-enforcer plugin is **enabled by default** when you install. It reacts to `session.idle` and issues at most one non-blocking continuation prompt per session when actionable todos remain.

### Disabling the plugin

Run the installer with `--plugin off`:

```
npx opencode-special-agents install --plugin off
```

Or manually remove `.opencode/plugin/continuation-enforcer.js` from the target directory.

### Removing the plugin

Removing the installed `plugin/continuation-enforcer.js` file disables the feature. The plugin is not loaded on next restart.

### Restart required

**Yes — all three components require a restart.** Agents, commands, and the plugin are all loaded at OpenCode startup and are never hot-reloaded:

- **Agents**: restarting loads new or changed agent prompts.
- **Commands**: restarting loads new or changed command definitions.
- **Plugin**: restarting loads the continuation-enforcer and resets its in-memory state.

## Restart matrix

| Component | Requires restart to take effect |
|---|---|
| Installing or updating agents | Yes |
| Installing or updating commands | Yes |
| Enabling or disabling the plugin | Yes |
| Any file change to `.opencode/agent/`, `.opencode/command/`, or `.opencode/plugin/` | Yes |

## State file

The installer writes `.opencode-special-agents.json` to the target `.opencode/` directory. It records installed files, their SHA-256 hashes, and plugin enabled state. This file is the installer's source of truth for update, uninstall, and doctor commands.

### .gitignore

The state file is a plain-text JSON file that may contain machine-specific paths. If you use `--gitignore-state`, the installer adds `.opencode-special-agents.json` to `.opencode/.gitignore`. This prevents the state file from being committed accidentally.

### Uninstall safety

Uninstall is **report-only without a valid state file** — it cannot safely remove files it cannot verify. Run `install` first to establish the state, then `uninstall` to remove.

## Scopes and precedence

Project-scope files (installed in `<project>/.opencode/`) shadow global files (installed in `~/.config/opencode/`) for the same filename. Installing the same agent at project scope takes precedence over a global installation of that agent.

## Invoking a Specific Agent

Use OpenCode's agent invocation mechanism to call a named agent directly. Replace `<agent>` with the agent filename without extension:

```
opencode --agent <agent> [prompt]
```

The orchestrator (Sisyphus) is typically invoked by default or explicitly via the CLI.

## Commands

Commands are Markdown files in `.opencode/command/` that instruct Sisyphus to invoke specialists in a defined sequence. Commands document inputs, outputs, and STOP conditions. **Markdown does not mechanically run agents or enforce execution** — commands describe intended behavior; Sisyphus executes the described delegation.

| Command | Purpose |
|---|---|
| `/plan` | Gather evidence, draft with Prometheus, surface gaps with Metis, review with Oracle and Momus, return a finalized plan or report why planning stopped. |
| `/review-plan` | Load an existing plan, run Metis and Momus with distinct review scopes, validate findings against repository evidence, return categorized blocker/important/advisory findings. |
| `/ultrawork` | Establish a bounded goal with explicit todos, delegate by role, verify results, and stop on completion or a concrete blocker. |

### Command invocation

Use OpenCode's command invocation mechanism. Replace `<command>` with the filename without extension:

```
opencode --command <command> [arguments]
```

## Working Notes (Notepads)

Commands may use `.agents/notepads/<sanitized-goal>/` to persist context across long or multi-session work. This directory is a local working space — not canonical product documentation.

Each notepad directory contains:

| File | Purpose |
|---|---|
| `goal.md` | The user's stated goal and any clarified decisions. |
| `findings.md` | Evidence gathered by Librarian, Metis, Oracle, and Momus. |
| `plan.md` | The draft or finalized plan. |
| `status.md` | Current blocker state and next action. |

**Never write credentials, tokens, or secret values to any notepad file.** Notepads are plain-text working notes and must not contain secrets.

### Sanitizing goal names

Replace spaces with hyphens, remove special characters, and lowercase the goal text. Example: `.agents/notepads/fix-auth-bug/`.

## Phase 3: Bounded Idle Continuation

A guarded plugin that reacts to `session.idle` and issues **at most one** non-blocking continuation prompt when actionable todos remain. State is in-memory, session-local, and resets on restart.

### Enabling

The installer places the plugin at `.opencode/plugin/continuation-enforcer.js` by default. To skip it, use `--plugin off` during install.

### Removing

Delete `.opencode/plugin/continuation-enforcer.js` from the target `.opencode/` directory. The feature is disabled on next restart.

### Restart Required

**Yes.** The plugin is loaded at startup and is not hot-reloaded. Restart OpenCode after installing or removing the plugin.

### How it works

1. On `session.idle`, the plugin fetches todos for that session.
2. It evaluates a deterministic guard:
   - **No actionable todos** (pending / in_progress) → no nudge.
   - **Already in-flight** → no nudge.
   - **Fingerprint unchanged** (same todos as last check) → no nudge.
   - **Continuation exhausted** (one nudge already used) → no nudge.
3. If allowed, it reserves state and queues a neutral continuation message via `promptAsync`.
4. On prompt failure, it fails closed: clears in-flight but retains the consumed count and fingerprint so the same state does not auto-retry.

### One-nudge cap

Each session receives **at most one** automatic continuation nudge. A second nudge requires a new set of actionable todos with a different fingerprint, or a manual user prompt.

### Cost

Each continuation nudge is a separate API turn. After the one automatic nudge, the model continues to receive normal `session.idle` events and can be manually re-invoked. Cost is bounded by design.

### Failure modes

- **Todo fetch error / missing data**: fail closed, no nudge.
- **Prompt queue failure**: fail closed, in-flight cleared, count/fingerprint retained — the same unchanged todo set will not retry automatically.
- **Plugin crash**: plugin is unloaded; OpenCode continues normally.

## Phase Overview

- **Phase 1** (this collection): Core agent roster, roles, and native permissions.
- **Phase 2**: Planning and review workflow — specialist commands, notepad lifecycle, and provenance documentation.
- **Phase 3**: Bounded idle continuation — a guarded `session.idle` reaction that issues one continuation prompt when actionable todos remain.

Do not combine phases during implementation — each phase is verified independently before the next begins.
