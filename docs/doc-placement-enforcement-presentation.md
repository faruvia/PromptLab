# Enforcing Markdown Placement in Claude Code
### Four Approaches — A Team Walkthrough

---

## The Problem

When Claude writes files, it doesn't always put them in the right place. A markdown file might land at the project root, inside a source directory, or wherever Claude decides is convenient. Without enforcement, conventions only hold as long as Claude (and the team) remembers them.

**Goal:** All project markdown must live in `docs/`. Everything else is a violation.

**Question:** How do we enforce that — and what are the trade-offs of each approach?

---

## Overview of the Four Approaches

```
Layer 1 — Natural language instruction     CLAUDE.md
           ↓
Layer 2 — Reusable skill (slash command)   /create-doc
           ↓
Layer 3 — Automated enforcement (hook)     PostToolUse → check-md-placement.ps1
           ↓
Layer 4 — Structured hook signalling       exit 0 / 1 / 2
```

Each layer adds more automation and less reliance on Claude's memory. They are **complementary**, not alternatives — the project uses all four.

---

## Approach 1 — CLAUDE.md Instruction

### What It Is

`CLAUDE.md` is a file Claude Code reads at every session start. Any rule written in it becomes part of Claude's working context for that session.

```markdown
# PromptLab

All project markdown files go in `docs/`. Never create `.md` files at the root
or in source directories. Exception: `CLAUDE.md`.
```

### How It Works

Claude reads `CLAUDE.md` on startup. The rule is now part of its system context — it behaves as if you told it the rule at the start of every conversation.

### Pros

| | |
|---|---|
| Zero infrastructure | No scripts, no config, no build step |
| Instant to change | Edit one file, rule takes effect next session |
| Human-readable | Non-technical team members can read and update it |
| Broad scope | Applies to everything Claude does, not just specific tools |

### Cons

| | |
|---|---|
| Memory-dependent | Claude can forget or deprioritise the rule mid-session |
| No enforcement | Violations produce no error — they silently succeed |
| Implicit only | Only shapes Claude's intent; doesn't validate outcomes |
| One copy | If the project has multiple `CLAUDE.md` files in subdirectories, rules can conflict |

### Best For

Setting the intent and default behaviour. Works well for rules that are easy to follow and rarely violated.

---

## Approach 2 — `create-doc` Skill (Slash Command)

### What It Is

A **project skill** is a reusable unit of Claude behaviour defined in a single `SKILL.md` file. It registers as a slash command in Claude Code.

```
.claude/
└── skills/
    └── create-doc/
        └── SKILL.md     ← defines /create-doc
```

Invoke it as:
```
/create-doc API reference for all endpoints
/create-doc architecture overview of the provider system
```

### How It Works

When `/create-doc <subject>` is called, Claude follows the steps in `SKILL.md`:

1. Derive a kebab-case filename from the argument
2. Check if `docs/<filename>.md` already exists (update vs. create)
3. Read relevant source files if the subject is code-related
4. Write the finished document to `docs/<filename>.md`

Because the destination is hard-coded in the skill instructions, the file always lands in the right place — assuming the skill is used.

### Skill Frontmatter

```yaml
---
name: create-doc
description: Create a markdown document in the docs/ folder.
argument-hint: "what to document (e.g. 'API reference', 'architecture overview')"
---
```

The `description` field also enables **auto-triggering** — Claude invokes the skill automatically when it detects phrases like "document X" or "write a guide for X".

### Pros

| | |
|---|---|
| Consistent output | Every invocation follows the same steps and format |
| Correct placement by design | `docs/` is baked into the skill — not a suggestion |
| Discoverable | Appears in the `/` command picker; argument hint is shown |
| Auto-trigger capable | Claude can invoke it from natural language, not just explicit slash commands |
| Version-controlled | The skill is a file in `.claude/skills/` — tracked in git |

### Cons

| | |
|---|---|
| Opt-in only | Claude can still write markdown directly, bypassing the skill |
| Session reload required | New or modified skills need a Claude Code restart to appear in the picker |
| Skill scope is narrow | Only helps when creating documentation; won't catch a markdown file written for another reason |
| No fallback enforcement | If Claude ignores the skill and writes directly, there is no correction |

### Best For

Standardising the creation of documentation files where the team explicitly invokes the skill. Pairs well with a hook for full coverage.

---

## Approach 3 — PostToolUse Hook (Automated Enforcement)

### What It Is

A **hook** is a shell command registered in `.claude/settings.json` that Claude Code runs automatically at lifecycle events. The `PostToolUse` event fires after every tool call — including every `Write`.

```
.claude/
├── settings.json                    ← registers the hook
└── hooks/
    └── check-md-placement.ps1       ← enforcement logic
```

### Registration

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Write",
        "hooks": [
          {
            "type": "command",
            "command": "powershell -NonInteractive -NoProfile -File .claude/hooks/check-md-placement.ps1"
          }
        ]
      }
    ]
  }
}
```

### How the Hook Enforces Placement

The hook receives the Write tool's input as JSON on stdin:

```json
{
  "tool_name": "Write",
  "tool_input": {
    "file_path": "notes.md",
    "content": "..."
  }
}
```

It checks the `file_path` against the exception list and the `docs/` prefix, then either passes, moves, or blocks.

### Exception List (in `check-md-placement.ps1`)

```powershell
# Named files exempt from enforcement
$allowedNames = @('CLAUDE.md')

# Directory subtrees that are never touched
$allowedPrefixes = @(
    'docs/',         # already correct
    '.claude/',      # Claude Code internals
    '.venv/',        # Python virtual environment
    'node_modules/'  # JS dependencies
)
```

### Decision Flow

```
Write tool fires
       │
       ▼
  Is the file .md?          No  → EXIT 0 (ignore)
       │ Yes
       ▼
  In allowed location?      Yes → EXIT 0 (correct)
       │ No
       ▼
  docs/<name> exists?       Yes → EXIT 2 (blocked — conflict)
       │ No
       ▼
  Move to docs/<name>
  ├── Success               → EXIT 1 (moved, Claude informed)
  └── Failure               → EXIT 2 (blocked — error)
```

### Pros

| | |
|---|---|
| Always fires | Catches every Write call, not just skill invocations |
| Self-healing | Moves the file automatically when there's no conflict |
| No reliance on Claude's memory | Rule is in code, not conversation context |
| Version-controlled | Hook script lives in `.claude/hooks/` alongside the project |
| Composable | Multiple hooks can be chained for the same event |

### Cons

| | |
|---|---|
| PostToolUse is reactive | The file is already written in the wrong place before the hook runs; the hook repairs rather than prevents |
| Adds latency | Every Write call now runs a PowerShell process |
| Windows-specific script | The `.ps1` is not portable to Linux/macOS without a bash equivalent |
| No undo on exit 2 | When blocked, the misplaced file remains on disk — Claude must delete or rename it |

### Best For

Catching any markdown write that slips through intent-level controls — the safety net that operates regardless of how the file was created.

---

## Approach 4 — Hook Exit Codes (0 / 1 / 2)

### What It Is

The exit code a hook returns is the signal that controls what Claude Code does next. Three values are defined:

### Exit 0 — Silent pass

```powershell
exit 0
```

No output, no interruption. Claude Code continues exactly as it was. Use this whenever the hook has nothing to report.

**In this project:** file is in `docs/`, is `CLAUDE.md`, or is in an exempt directory.

---

### Exit 1 — Non-blocking informational message

```powershell
Write-Output "HOOK: Moved 'notes.md' → 'docs/notes.md' (CLAUDE.md rule)."
exit 1
```

Claude Code shows the hook's stdout to Claude as an informational message. Claude reads it, updates its internal understanding (e.g. the file is now at `docs/notes.md`), and **continues without interruption**.

**In this project:** a misplaced `.md` was successfully moved to `docs/`.

---

### Exit 2 — Blocking error

```powershell
Write-Output "HOOK BLOCKED: 'notes.md' cannot be moved — 'docs/notes.md' already exists."
exit 2
```

Claude Code stops the current operation. Claude reads the error and **must actively resolve it** — rename the file, merge content, or take another corrective action — before it can proceed.

**In this project:** a naming conflict prevents auto-move, or the filesystem move failed.

---

### Summary Table

| Exit code | Name | Claude sees output | Claude continues | Use when |
|---|---|---|---|---|
| `0` | Allow | No | Yes | Nothing to report |
| `1` | Warn | Yes (info) | Yes | Action taken successfully, Claude should know |
| `2` | Block | Yes (error) | No | Human or model intervention required |

### Pros of This Signalling Model

| | |
|---|---|
| Granular control | Three distinct levels of severity in one integer |
| Exit 1 enables self-healing | Hook can fix a problem and inform Claude without blocking it |
| Exit 2 forces resolution | Broken state cannot silently continue |
| Standard interface | Any language, any script — the exit code protocol is universal |

### Cons of This Signalling Model

| | |
|---|---|
| PostToolUse cannot prevent | Exit 2 from a PostToolUse hook stops Claude's *next* action, not the write that already happened |
| Exit code meanings are non-obvious | `1` usually means error in Unix convention; here it means "non-blocking info" |
| No structured error payload | Hook output is plain text — no machine-readable error type or metadata |
| Silent exit 0 can hide bugs | A hook that crashes and exits 0 by default will never be noticed |

---

## Side-by-Side Comparison

| | CLAUDE.md | Skill (`/create-doc`) | Hook (move) | Exit codes |
|---|---|---|---|---|
| **Layer** | Intent | Pattern | Enforcement | Signalling |
| **When it acts** | Session start | On invocation | After every Write | Inside hook |
| **Enforcement?** | No | No (opt-in) | Yes (automatic) | Yes (blocking) |
| **Complexity** | Minimal | Low | Medium | Medium |
| **Portability** | Any OS | Any OS | Windows (`.ps1`) | Any OS |
| **Requires restart?** | Yes (session) | Yes (session) | No | No |
| **Catches all writes?** | No | No | Yes | Yes |
| **Self-healing?** | No | No | Yes (exit 1) | Depends on hook |

---

## How the Layers Work Together

```
Developer asks Claude to document something
              │
              ▼
   Claude reads CLAUDE.md rule ──── Layer 1: Intent
   "put markdown in docs/"
              │
              ▼
   Team uses /create-doc ────────── Layer 2: Pattern
   (skill always writes to docs/)
              │
              ▼
   Claude writes a file (any path)
              │
   PostToolUse hook fires ────────── Layer 3: Enforcement
              │
     ┌────────┼────────┐
     ▼        ▼        ▼
   Exit 0   Exit 1   Exit 2 ──────── Layer 4: Signalling
   (pass)   (moved)  (blocked)
```

No single layer is sufficient on its own:
- CLAUDE.md sets intent but cannot enforce.
- The skill enforces placement but only when invoked.
- The hook catches everything but fires after the fact.
- Exit codes give the hook three distinct outcomes.

Together they form a **defence-in-depth** approach where each layer handles what the previous layer misses.

---

## Key Takeaways

1. **CLAUDE.md** is the foundation — always write your rules here first. It's free, fast, and shapes Claude's default behaviour.

2. **Skills** standardise *how* tasks are done, not just *what* constraints exist. Use them when a repeatable workflow needs to be enforced by convention.

3. **Hooks** are the safety net — they enforce rules at the filesystem level regardless of how Claude or the user triggered a write.

4. **Exit codes** determine the outcome: silent pass (0), inform and continue (1), or stop and fix (2). Match the severity to the actual impact of the violation.

5. The three layers are **complementary**. Removing any one of them weakens the overall enforcement: intent without enforcement is a convention; enforcement without intent is brittle; signalling without enforcement is noise.

---

## File Reference

| File | Role |
|---|---|
| [`CLAUDE.md`](../CLAUDE.md) | Natural language rule — session-level intent |
| [`.claude/skills/create-doc/SKILL.md`](../.claude/skills/create-doc/SKILL.md) | Skill definition — `/create-doc` slash command |
| [`.claude/settings.json`](../.claude/settings.json) | Hook registration — wires PostToolUse to the script |
| [`.claude/hooks/check-md-placement.ps1`](../.claude/hooks/check-md-placement.ps1) | Hook script — move enforcement with exit 0/1/2 |
| [`docs/create-doc-skill.md`](create-doc-skill.md) | Deep dive: the create-doc skill |
| [`docs/claude-code-hooks.md`](claude-code-hooks.md) | Deep dive: hooks and exit codes |
