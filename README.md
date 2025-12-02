# mechanic-mcp

Mechanic MCP server for the task library and docs. Offline by default (bundled data), serving public URLs for tasks (`https://tasks.mechanic.dev/{handle}`) and docs (`https://learn.mechanic.dev/{path}`).

## User guide
- Requirements: Node.js 18+, MCP-capable client (Cursor, Claude Desktop, Codex, Gemini CLI, etc.).
- What you can ask: find tasks; fetch task code (subscriptions + script/JS blocks); find docs; suggest similar tasks; get doc content.
- Setup (use `npx mechanic-mcp@latest`):
  - Cursor:
    ```json
    {
      "mcpServers": {
        "mechanic-mcp": {
          "command": "npx",
          "args": ["-y", "mechanic-mcp@latest"]
        }
      }
    }
    ```
  - Claude Desktop:
    ```json
    {
      "mcpServers": {
        "mechanic-mcp": {
          "command": "npx",
          "args": ["-y", "mechanic-mcp@latest"]
        }
      }
    }
    ```
  - Codex (`~/.codex/config.toml`):
    ```toml
    [mcp_servers.mechanic-mcp]
    command = "npx"
    args = ["-y", "mechanic-mcp@latest"]
    ```
  - Gemini CLI: same JSON as Cursor/Claude.
- Tools:
  - `search_tasks`: returns public URL, tags, subscriptions/subscriptions_template, options.
  - `search_docs`: returns public URL/sourceUrl.
  - `get_task` (tasks only): script + subscriptions + options + JS blocks; not full JSON.
  - `get_doc` (docs only): full markdown.
  - `similar_tasks`: related tasks by tags/subscriptions/title.
  - `refresh_index`: rebuild (not needed for packaged data).
- Usage notes: cite public URLs (no local paths/.md); prefer GraphQL in code; when sharing code, return subscriptions + script/JS (relevant bits), not full JSON.

## For maintainers
- Bundled data: `dist/data/index.json.gz`, `records.json.gz`, `manifest.json` (users don’t need source repos).
- Regenerate (if needed):
  ```bash
  MECHANIC_DOCS_PATH=/path/to/mechanic-docs MECHANIC_TASKS_PATH=/path/to/mechanic-tasks npm run build:data
  npm run build
  ```
- Tests: `npm run test:smoke`, `npm run test:smoke-doc`, `npm run test:smoke-task`.
- Publish: bump version, `npm publish`.

## Env (optional)
- `MECHANIC_DATA_PATH` (default `dist/data`), `MECHANIC_DOCS_PATH`, `MECHANIC_TASKS_PATH`, repo URLs/branches, sync interval.

## Runtime
- Loads bundled index/records from `MECHANIC_DATA_PATH`; `refresh_index` rebuilds if you opt in. Stdio transport; TF-IDF search with fuzzy + pagination; no network calls for search/resources.
