# Claude Code Hooks

## What Are Hooks?

Hooks are shell commands that Claude Code runs automatically at defined points in its tool execution lifecycle. They let you attach custom logic — validation, enforcement, logging, notifications — to Claude's actions without modifying Claude itself.

A hook receives structured JSON on stdin describing what Claude just did (or is about to do), runs its logic, and signals the outcome to Claude Code via its exit code.

---

## Benefits

| Benefit | Description |
|---|---|
| **Automated enforcement** | Conventions (e.g. "all markdown goes in `docs/`") are checked on every action, not just when remembered |
| **No prompt engineering required** | The rule lives in code, not in natural-language instructions that can be forgotten or misinterpreted |
| **Composable** | Multiple hooks can be registered for the same event; they all run independently |
| **Language-agnostic** | Any executable works — PowerShell, bash, Python, Node — as long as it reads stdin and exits with a code |
| **Auditable** | Hook scripts are version-controlled alongside the project, making enforcement history visible in git |

---

## How Hooks Work

### Lifecycle Events

Claude Code fires hooks at five points in its execution lifecycle:

| Event | When it fires | Typical use |
|---|---|---|
| `PreToolUse` | Before a tool runs | Block forbidden operations before they happen |
| `PostToolUse` | After a tool runs | Inspect or repair the result of a tool call |
| `Stop` | When Claude finishes a turn | Run post-response checks or notifications |
| `SubagentStop` | When a spawned sub-agent finishes | Same as Stop, for sub-agents |
| `Notification` | When Claude Code emits a notification | Forward alerts to Slack, email, etc. |

### Registration — `.claude/settings.json`

Hooks are registered in the project's settings file:

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

| Field | Purpose |
|---|---|
| `PostToolUse` | The lifecycle event to hook into |
| `matcher` | Tool name filter — `"Write"` fires only after Write calls; `".*"` fires after every tool |
| `type` | Always `"command"` — hooks run as shell commands |
| `command` | The shell command to execute; runs with the project root as the working directory |

### Stdin JSON

When the hook runs, Claude Code writes a JSON object to its stdin:

```json
{
  "session_id": "abc123",
  "tool_name": "Write",
  "tool_input": {
    "file_path": "some-file.md",
    "content": "..."
  },
  "tool_response": { ... }
}
```

The hook reads this, inspects the relevant fields, and acts accordingly.

---

## Exit Codes

The hook's exit code is the primary signal back to Claude Code. Three values are defined:

### Exit 0 — Allow (silent)

```
exit 0
```

Everything is fine. Claude Code continues normally. No message is shown to Claude or the user. This is the correct exit for any case the hook doesn't need to act on.

**Example:** The written file is `docs/guide.md` — already in the right place.

---

### Exit 1 — Non-blocking warning

```
Write-Output "HOOK: Moved 'notes.md' → 'docs/notes.md'"
exit 1
```

The hook has something to report, but it is not a hard error. Claude Code shows the hook's stdout output to Claude as an informational message. Claude can read it, update its internal state (e.g. remember the new file path), and continue its task without interruption.

**Example:** A misplaced `.md` file was auto-moved to `docs/`. Claude is told so it can reference the correct path going forward.

---

### Exit 2 — Blocking error

```
Write-Output "HOOK BLOCKED: 'notes.md' cannot be moved — 'docs/notes.md' already exists."
exit 2
```

A hard error that Claude Code cannot silently ignore. The current operation is **stopped**. Claude reads the hook's stdout as an error message and must actively resolve the problem — rename the file, merge content, or take another corrective action — before proceeding.

**Example:** A misplaced `.md` file could not be auto-moved because a file with the same name already exists in `docs/`.

### Summary

| Exit code | Meaning | Claude sees output? | Claude continues? |
|---|---|---|---|
| `0` | All good, nothing to report | No | Yes |
| `1` | Action taken, FYI | Yes (informational) | Yes |
| `2` | Hard error, must fix | Yes (error) | No — must resolve first |

---

## Enforcing Markdown Placement with a Hook

This project enforces the convention from `CLAUDE.md`:

> All project markdown files go in `docs/`. Exception: `CLAUDE.md`.

### The Problem

Claude may occasionally write a markdown file to the project root or a source directory — especially when not given an explicit path. Without automation, this relies on Claude remembering the rule every time.

### The Solution

A `PostToolUse` hook on the `Write` tool intercepts every markdown file write after it happens and either confirms the placement is correct, repairs it automatically, or blocks and asks Claude to fix it.

### Hook Location

```
.claude/
├── settings.json                    ← registers the hook
└── hooks/
    └── check-md-placement.ps1       ← hook implementation
```

### Decision Flow

```
Write tool fires
       │
       ▼
  Is the file a .md?
  ├── No  → EXIT 0 (not our concern)
  └── Yes
       │
       ▼
  Is it in docs/, .claude/, .venv/, node_modules/?
  Is the filename CLAUDE.md?
  ├── Yes → EXIT 0 (correct location or exempt)
  └── No  (misplaced .md)
       │
       ▼
  Does docs/<same-name>.md already exist?
  ├── Yes → EXIT 2 (BLOCKED — conflict, Claude must resolve)
  └── No
       │
       ▼
  Move file to docs/<filename>
  ├── Success → EXIT 1 (moved, inform Claude)
  └── Failure → EXIT 2 (BLOCKED — permissions or other error)
```

### Exception List

The hook defines two categories of exceptions in the script:

**Named files** — specific filenames allowed outside `docs/` regardless of location:
```powershell
$allowedNames = @(
    'CLAUDE.md'
)
```

**Directory prefixes** — entire subtrees that are never touched:
```powershell
$allowedPrefixes = @(
    'docs/',         # already correct
    '.claude/',      # Claude Code internals (skills, hooks, settings)
    '.venv/',        # Python virtual environment
    'node_modules/'  # JS dependencies
)
```

To add a new exception, append to either array and commit the change.

### Exit Code Scenarios in Practice

| Scenario | File written | Hook exits |
|---|---|---|
| Claude writes to `docs/guide.md` | `docs/guide.md` | **0** — already in docs/ |
| Claude writes `CLAUDE.md` | `CLAUDE.md` | **0** — named exception |
| Claude writes a skill definition | `.claude/skills/my-skill/SKILL.md` | **0** — `.claude/` prefix exempt |
| Claude writes `notes.md` at root, `docs/notes.md` does not exist | `notes.md` → moved to `docs/notes.md` | **1** — moved, Claude informed |
| Claude writes `guide.md` at root, `docs/guide.md` already exists | `guide.md` | **2** — conflict, Claude blocked |
| Move fails due to locked file | `report.md` | **2** — error, Claude blocked |

### Hook Script

Full source: [`.claude/hooks/check-md-placement.ps1`](.claude/hooks/check-md-placement.ps1)

Key sections:

```powershell
# Read and parse stdin JSON from Claude Code
$raw = [Console]::In.ReadToEnd()
$event = $raw | ConvertFrom-Json
$filePath = $event.tool_input.file_path

# EXIT 0 — not a markdown file
if (-not $filePath.ToLower().EndsWith('.md')) { exit 0 }

# EXIT 0 — in an allowed location or named exception
foreach ($prefix in $allowedPrefixes) {
    if ($norm -like "$prefix*") { exit 0 }
}
if ($allowedNames -contains $fileName) { exit 0 }

# EXIT 2 — conflict: same name already in docs/
if (Test-Path $destPath) {
    Write-Output "HOOK BLOCKED: '$filePath' cannot be auto-moved — '$destPath' already exists."
    exit 2
}

# EXIT 1 — moved successfully
Move-Item -Path $filePath -Destination $destPath
Write-Output "HOOK: Moved '$filePath' → '$destPath'"
exit 1
```

---

## File Structure Reference

```
.claude/
├── settings.json                    ← hook registration
└── hooks/
    └── check-md-placement.ps1       ← enforcement script
docs/
└── claude-code-hooks.md             ← this file
CLAUDE.md                            ← project conventions (named exception)
```
