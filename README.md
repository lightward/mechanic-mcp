# mechanic-mcp

Mechanic MCP server that indexes the task library and generated docs, ships with an offline search index, and exposes MCP resources/tools over stdio.

## What it does
- Builds a combined index of `mechanic-tasks/tasks/*.json` and `docs/**` (markdown) and packages it as `dist/data/index.json.gz` with a manifest.
- MCP server over stdio:
  - Resources for every task/doc (`mechanic-task://{id}`, `mechanic-docs://{id}`).
  - Tools: `search_tasks` (scope=tasks/docs/all, fuzzy/pagination) and `refresh_index` (rebuild + re-register resources).
- Offline by default; no network fetch needed for search/resources.

## Getting started
```bash
npm install
npm run build:data   # (for maintainers) rebuilds dist/data/index.json.gz + records.json.gz + manifest.json from source repos
npm run build        # compile TS to dist
node dist/index.js   # runs MCP server on stdio
```

Packaged data
- The published package includes `dist/data/index.json.gz`, `records.json.gz`, and `manifest.json` so you can run without local repos. `build:data` is only needed if you’re regenerating data from `mechanic-docs`/`mechanic-tasks`.

## Commands / tools
- `search_tasks` input (zod validated):
  - `query` (string, required)
  - `limit` (1-50, default 10), `offset` (>=0)
  - `fuzzy` (bool, default true), `fuzzyMaxEdits` (0-2), `fuzzyMaxCandidates` (1-5)
  - `tags[]` (optional), `subscriptions[]` (optional; substring match in subscriptions/template)
- `search_tasks` output:
  - `items[]`: `{id, kind, title, path, url, snippet, tags, subscriptions, options, score}`
  - `nextOffset` when more results remain
- `search_docs` input/output: same shape as `search_tasks` but scoped to docs and `url` points to `https://learn.mechanic.dev/{path}`
- `refresh_index`: no input; rebuilds from local sources and re-registers resources.
- `get_task`: input `{id}` (or handle); output full task payload (name/tags/subscriptions/options/script/JS blocks, public URL) for import/editing.
- `similar_tasks`: input `{handle, limit}`; output nearby tasks by overlapping tags/subscriptions/title with public URLs.

Resources
- Docs are exposed as resources (URI percent-encoded); use `list_resources` + `read_resource` to fetch full markdown. Tasks are tools-only.

## Resources
- `mechanic-task://task:{handle}` → JSON task payload (from task export)
- `mechanic-docs://doc:{relativePath}` → markdown content

## Configuration (env)
- `MECHANIC_DOCS_PATH` (default `../mechanic-docs`) — primary documentation set
- `MECHANIC_TASKS_PATH` (default `../mechanic-tasks`)
- `MECHANIC_DOCS_REPO_URL`, `MECHANIC_TASKS_REPO_URL` (optional; for git sync)
- `MECHANIC_DOCS_BRANCH`, `MECHANIC_TASKS_BRANCH` (default `main`)
- `MECHANIC_SYNC_MINUTES` (default `30`)
- `MECHANIC_INDEX_MAX_DOCS` (default `20000`)
- `MECHANIC_DATA_PATH` (default `dist/data`) — where the prebuilt index/manifest live

## Runtime behavior
- On startup, loads prebuilt index from `MECHANIC_DATA_PATH`; rebuild only if you run `npm run build:data`.
- Logs manifest if present, and counts of docs/tasks.
- `refresh_index` triggers a rebuild and re-registers resources in-process.

## Notes
- Transport is stdio-only for now.
- Search is TF-IDF with fuzzy (edit distance up to 2) and pagination.
- Everything runs locally; no network calls for search/resources.
