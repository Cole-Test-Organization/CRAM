# Todoist Integration

CLI tool for creating and managing Todoist tasks. Used during the call notes workflow to extract action items and create them directly in Todoist.

## Quick Start

```bash
cd todoist && npm install
```

API token goes in `todoist/.env`:
```
TODOIST_API_TOKEN=your_token_here
```
Get your token from: https://todoist.com/app/settings/integrations/developer

## Usage

```bash
# Create a single task (defaults to whatever TODOIST_DEFAULT_PROJECT/SECTION are set to)
node todoist/src/index.js create-task "Follow up with Acme on POV results" --labels "acme" --due "next Friday"

# Batch create from JSON on stdin (primary mode for call notes workflow)
echo '[{"content":"Task 1","labels":["acme"]},{"content":"Task 2","labels":["acme"]}]' | node todoist/src/index.js create-tasks

# List projects and sections
node todoist/src/index.js list-projects
node todoist/src/index.js list-sections

# List tasks by label
node todoist/src/index.js list-tasks --label "acme"

# Close a task
node todoist/src/index.js close-task <id>

# Verify auth and defaults
node todoist/src/index.js status
```

## Defaults

All tasks go to whatever project (and optional section) is configured via `TODOIST_DEFAULT_PROJECT` and `TODOIST_DEFAULT_SECTION` env vars, unless overridden with `--project` / `--section`. Default: `Inbox` (no section).
