# Todoist

CLI and library for creating and managing Todoist tasks. Used by the API's `/todoist` endpoints and available directly as a CLI for ad-hoc use.

All tasks default to whichever project (and optional section) is configured via `TODOIST_DEFAULT_PROJECT` / `TODOIST_DEFAULT_SECTION` — defaults to `Inbox`.

## Setup

```bash
cd todoist
npm install
```

Create `todoist/.env` with your API token:

```
TODOIST_API_TOKEN=your_token_here
```

Get your token from: https://todoist.com/app/settings/integrations/developer

## CLI

```bash
# Create a single task (defaults to the configured project/section)
node src/index.js create-task "Follow up with Acme on POV results" \
  --labels "acme" --due "next Friday"

# Batch create from JSON on stdin
echo '[{"content":"Task 1","labels":["acme"]},{"content":"Task 2","labels":["acme"]}]' \
  | node src/index.js create-tasks

# List projects and sections
node src/index.js list-projects
node src/index.js list-sections

# List tasks by label
node src/index.js list-tasks --label "acme"

# Close a task
node src/index.js close-task <id>

# Verify auth and defaults
node src/index.js status
```

### Task object shape

```json
{
  "content": "Task title",
  "description": "Additional context",
  "labels": ["company-slug"],
  "due_string": "next Friday",
  "due_date": "2026-04-20",
  "priority": 3
}
```

Only `content` is required. `priority` is 1 (normal) through 4 (urgent).

## API integration

The Fastify API exposes the same operations at `/todoist/tasks`. See [api/README.md](../api/README.md) for endpoint details.

```bash
# Create a task via the API
curl -X POST http://localhost:3200/todoist/tasks \
  -H 'Content-Type: application/json' \
  -d '{"content":"Follow up on BPA","labels":["acme"],"due_string":"next Friday"}'
```

## Project layout

```
todoist/
├── src/
│   ├── index.js   # CLI entry point
│   ├── api.js     # Todoist REST client (used by both CLI and API)
│   └── config.js  # Loads .env, resolves default project/section
└── .env           # TODOIST_API_TOKEN (gitignored)
```
