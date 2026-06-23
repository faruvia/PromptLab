# Hook: check-md-placement.ps1
# Event: PostToolUse (Write tool)
# Purpose: Enforce the CLAUDE.md rule that all project markdown must live in docs/.
#          Reads the Write tool's stdin JSON, extracts the file path, and either:
#            EXIT 0 — file is already in an allowed location (silent pass-through)
#            EXIT 1 — file was auto-moved to docs/ (non-blocking info shown to Claude)
#            EXIT 2 — file cannot be moved due to a conflict (blocking error; Claude must resolve)

# ── Read stdin JSON ──────────────────────────────────────────────────────────
$raw = [Console]::In.ReadToEnd()
if (-not $raw) { exit 0 }

try {
    $event = $raw | ConvertFrom-Json
} catch {
    exit 0  # Unparseable input — don't block
}

$filePath = $event.tool_input.file_path
if (-not $filePath) { exit 0 }

# ── Only act on .md files ────────────────────────────────────────────────────
if (-not $filePath.ToLower().EndsWith('.md')) {
    # EXIT 0 — Not a markdown file; nothing to enforce
    exit 0
}

# ── Normalise to forward slashes for consistent matching ─────────────────────
$norm = $filePath.Replace('\', '/')

# ── Exception list: individual filenames allowed anywhere ────────────────────
# Add entries here for any markdown files Claude Code itself manages at the root.
$allowedNames = @(
    'CLAUDE.md'
)

# ── Exception prefixes: directory subtrees that are exempt ───────────────────
# Files under these prefixes are never touched regardless of depth.
$allowedPrefixes = @(
    'docs/',        # already in the right place
    '.claude/',     # Claude Code internal files (skills, hooks, settings)
    '.venv/',       # Python virtual environment
    'node_modules/' # JS dependencies
)

# ── Check: file is in docs/ or another exempt subtree ───────────────────────
foreach ($prefix in $allowedPrefixes) {
    if ($norm -like "$prefix*" -or $norm -eq $prefix.TrimEnd('/')) {
        # EXIT 0 — File is in an allowed directory
        exit 0
    }
}

# ── Check: file is a named exception (e.g. CLAUDE.md) ───────────────────────
$fileName = Split-Path $norm -Leaf
if ($allowedNames -contains $fileName) {
    # EXIT 0 — File is on the named-exception list
    exit 0
}

# ── File is a misplaced .md — attempt to move it to docs/ ───────────────────
$destPath = "docs/$fileName"

if (Test-Path $destPath) {
    # EXIT 2 — BLOCKING: a file with the same name already exists in docs/.
    # Claude must decide: rename the new file or merge content manually.
    Write-Output "HOOK BLOCKED: '$filePath' cannot be auto-moved to docs/ — '$destPath' already exists."
    Write-Output "Resolution: place the file at a unique path inside docs/, or merge content into the existing file."
    exit 2
}

# Ensure docs/ exists (should always be true in this project, but be safe)
if (-not (Test-Path 'docs')) {
    New-Item -ItemType Directory -Path 'docs' | Out-Null
}

try {
    Move-Item -Path $filePath -Destination $destPath -ErrorAction Stop
    # EXIT 1 — NON-BLOCKING: file moved successfully. Claude sees this message
    # and can continue; it should reference docs/<filename> going forward.
    Write-Output "HOOK: Moved '$filePath' → '$destPath' (CLAUDE.md rule: all markdown belongs in docs/)."
    exit 1
} catch {
    # EXIT 2 — BLOCKING: move failed for an unexpected reason (permissions, locked file, etc.)
    Write-Output "HOOK BLOCKED: Could not move '$filePath' to '$destPath': $_"
    Write-Output "Resolution: manually place the file inside docs/ and retry."
    exit 2
}
