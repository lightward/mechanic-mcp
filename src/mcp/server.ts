import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import type { DataStore } from '../core/engine.js';
import { searchStoreAdvanced } from '../core/engine.js';
import {
  searchInputSchema,
  searchResponseSchema,
  taskResourceSchema,
  docResourceSchema,
  taskIdSchema,
  taskDetailSchema,
  docIdSchema,
  docDetailSchema,
  similarTasksInputSchema,
  similarTasksResponseSchema,
  lintTaskInputSchema,
  lintTaskResponseSchema,
  previewTaskInputSchema,
  previewTaskResponseSchema,
  taskExamplesInputSchema,
  taskExamplesResponseSchema,
  taskListInputSchema,
  taskListResponseSchema,
  buildTaskExportInputSchema,
  buildTaskExportResponseSchema,
} from '../schemas.js';
import type { RecordItem, SearchHit, TaskRecord } from '../types.js';
import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import { encodeUri, decodeUri } from '../util/uri.js';
import type { ApiConfig } from '../config.js';

export interface McpServerOptions {
  getStore: () => DataStore;
  refresh: () => Promise<void>;
  port?: number;
  apiConfig?: ApiConfig;
}

export async function startMcpServer(options: McpServerOptions): Promise<() => Promise<void>> {
  const { getStore, refresh, apiConfig } = options;
  const store = getStore();

  const mcp = new McpServer(
    {
      name: 'mechanic-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
      instructions: [
        'You are an assistant helping developers write and customize Mechanic tasks in Liquid.',
        'Use search_tasks for task library queries; use search_docs for Mechanic docs. Use get_task for tasks only, get_doc or resources/read for docs.',
        'If you cannot find a suitable task example, search docs for actions/filters/tags and prefer those references when generating code.',
        'Inputs: query (required); limit<=50; offset>=0; fuzzyMaxEdits<=2; fuzzyMaxCandidates<=5.',
        'Docs are resources; tasks are tools. Resource URIs are percent-encoded from list_resources.',
        'Always use public URLs: tasks.mechanic.dev/{handle} for tasks, learn.mechanic.dev/{path} for docs. Never cite local repo paths or .md filenames.',
        'Prefer Shopify GraphQL in code examples; REST is deprecated in Mechanic tasks.',
        'Recommend existing library tasks first; build new only if no close match.',
        'For task code, return subscriptions + script/JS (relevant bits), not full JSON; include the public task URL.',
        'Use search_task_examples to pull code examples from the task library, and get_task for full scripts.',
        'Use build_task_export to convert script + subscriptions into a canonical task export for lint/preview or import.',
        'When iterating with lint/preview, submit a full task export (machine-friendly). When presenting to humans, show script + subscriptions. When providing an importable artifact, return the full task export.',
        'Lint/preview tools require MECHANIC_API_BASE; MECHANIC_TOOL_TOKEN may be required by the API.',
      ].join('\n'),
    },
  );

  const requireApiConfig = (): Required<ApiConfig> => {
    if (!apiConfig || !apiConfig.baseUrl) {
      throw new Error('MECHANIC_API_BASE not configured; set MECHANIC_API_BASE (and MECHANIC_TOOL_TOKEN if required) for lint/preview.');
    }
    return {
      baseUrl: apiConfig.baseUrl,
      token: apiConfig.token,
      timeoutMs: apiConfig.timeoutMs,
    } as Required<ApiConfig>;
  };

  const callMechanicApi = async <T>(path: string, body: unknown): Promise<T> => {
    const cfg = requireApiConfig();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), cfg.timeoutMs);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (cfg.token) {
        headers['X-Mechanic-Tool-Token'] = cfg.token;
      }

      const response = await fetch(`${cfg.baseUrl}${path}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      let data: unknown = null;
      if (text.length > 0) {
        try {
          data = JSON.parse(text);
        } catch {
          data = { message: text };
        }
      }

      if (!response.ok) {
        const message = (data as any)?.message || `HTTP ${response.status}`;
        const error: any = new Error(message);
        error.status = response.status;
        throw error;
      }

      return data as T;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error('Request timed out');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  };

  const sanitizeTaskPayload = (task: Record<string, unknown>) => {
    return Object.fromEntries(
      Object.entries(task).filter(([, value]) => value !== null && value !== undefined),
    );
  };

  const normalizeTaskPayload = (task: Record<string, unknown>) => {
    const normalized = sanitizeTaskPayload(task);
    const subscriptionsTemplate =
      typeof normalized.subscriptions_template === 'string'
        ? normalized.subscriptions_template.trim()
        : '';

    if (!subscriptionsTemplate && Array.isArray(normalized.subscriptions)) {
      if (normalized.subscriptions.length > 0) {
        normalized.subscriptions_template = normalized.subscriptions.join('\n');
      }
    }

    return normalized;
  };

  const normalizeSubscriptionsFromTemplate = (task: Record<string, unknown>) => {
    if (!task.subscriptions && typeof task.subscriptions_template === 'string') {
      const subscriptions = task.subscriptions_template
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (subscriptions.length > 0) {
        task.subscriptions = subscriptions;
      }
    }
    return task;
  };

  const buildTaskExportPayload = (task: Record<string, unknown>) => {
    const normalized = normalizeTaskPayload(task);
    return normalizeSubscriptionsFromTemplate(normalized);
  };

  const normalizeApiError = (error: unknown) => {
    const status = (error as any)?.status as number | undefined;
    const rawMessage = (error as Error)?.message || 'Unknown error';
    const message = rawMessage.includes('HTTP') ? rawMessage : rawMessage.trim();
    let code = 'unknown_error';
    let hint: string | undefined;

    if (status === 401) {
      code = 'unauthorized';
      hint = 'Check MECHANIC_TOOL_TOKEN.';
    } else if (status === 403) {
      code = 'forbidden';
      hint = 'Token lacks access or does not match the API instance.';
    } else if (status === 404) {
      code = 'not_found';
    } else if (status === 408) {
      code = 'timeout';
    } else if (status && status >= 500) {
      code = 'upstream_error';
    } else if (message.toLowerCase().includes('timeout')) {
      code = 'timeout';
    }

    return {
      code,
      message,
      status,
      hint,
    };
  };

  const hasPreviewInputs = (task: Record<string, unknown>) => {
    const subscriptionsTemplate =
      typeof task.subscriptions_template === 'string' && task.subscriptions_template.trim() !== '';
    const subscriptions = Array.isArray(task.subscriptions) && task.subscriptions.length > 0;
    const previewDefs =
      Array.isArray(task.preview_event_definitions) && task.preview_event_definitions.length > 0;

    return subscriptionsTemplate || subscriptions || previewDefs;
  };

  const taskMatchesFilters = (record: TaskRecord, tags?: string[], subscriptions?: string[]) => {
    if (tags && tags.length > 0) {
      const recordTags = (record.tags || []).map((tag) => tag.toLowerCase());
      const hasAll = tags.every((tag) => recordTags.includes(tag.toLowerCase()));
      if (!hasAll) return false;
    }

    if (subscriptions && subscriptions.length > 0) {
      const subs = (record.events || []).map((s) => s.toLowerCase()).join(' ');
      const template = (record.subscriptions_template || '').toLowerCase();
      const combined = `${subs} ${template}`;
      const hasAllSubs = subscriptions.every((sub) => combined.includes(sub.toLowerCase()));
      if (!hasAllSubs) return false;
    }

    return true;
  };

  const findLiteralMatches = (
    text: string,
    pattern: string,
    caseSensitive: boolean,
    maxMatches: number,
    contextChars: number,
  ) => {
    const haystack = caseSensitive ? text : text.toLowerCase();
    const needle = caseSensitive ? pattern : pattern.toLowerCase();
    const matches: Array<{ index: number; snippet: string }> = [];
    let count = 0;
    let index = 0;

    while (index <= haystack.length) {
      const next = haystack.indexOf(needle, index);
      if (next === -1) break;
      count += 1;

      if (matches.length < maxMatches) {
        const start = Math.max(0, next - contextChars);
        const end = Math.min(text.length, next + needle.length + contextChars);
        const prefix = start > 0 ? '...' : '';
        const suffix = end < text.length ? '...' : '';
        const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
        matches.push({ index: next, snippet });
      }

      index = next + needle.length;
    }

    return { count, matches };
  };

  const collectPatternMatches = (
    record: TaskRecord,
    pattern: string,
    patternField: 'script' | 'online_store_javascript' | 'order_status_javascript' | 'all',
    caseSensitive: boolean,
    maxMatches: number,
    contextChars: number,
  ) => {
    const fields: Array<'script' | 'online_store_javascript' | 'order_status_javascript'> =
      patternField === 'all'
        ? ['script', 'online_store_javascript', 'order_status_javascript']
        : [patternField];
    const matches: Array<{ field: 'script' | 'online_store_javascript' | 'order_status_javascript'; index: number; snippet: string }> =
      [];
    let count = 0;
    let remaining = maxMatches;

    for (const field of fields) {
      const text = record[field] || '';
      if (!text) continue;
      const result = findLiteralMatches(text, pattern, caseSensitive, remaining, contextChars);
      count += result.count;
      result.matches.forEach((match) => {
        matches.push({ field, index: match.index, snippet: match.snippet });
      });
      remaining = Math.max(0, remaining - result.matches.length);
      if (remaining === 0) break;
    }

    return { count, matches };
  };

  const collectPatternMatchesForPatterns = (
    record: TaskRecord,
    patterns: string[],
    matchMode: 'any' | 'all',
    patternField: 'script' | 'online_store_javascript' | 'order_status_javascript' | 'all',
    caseSensitive: boolean,
    maxMatches: number,
    contextChars: number,
  ) => {
    let count = 0;
    let matchedPatterns = 0;
    let remaining = maxMatches;
    const matches: Array<{ field: 'script' | 'online_store_javascript' | 'order_status_javascript'; index: number; snippet: string; pattern?: string }> =
      [];

    for (const pattern of patterns) {
      if (!pattern) continue;
      const result = collectPatternMatches(
        record,
        pattern,
        patternField,
        caseSensitive,
        remaining,
        contextChars,
      );
      if (result.count > 0) matchedPatterns += 1;
      count += result.count;
      result.matches.forEach((match) => {
        matches.push({ ...match, pattern });
      });
      remaining = Math.max(0, remaining - result.matches.length);
    }

    if (matchMode === 'all' && matchedPatterns < patterns.length) return null;
    if (matchMode === 'any' && matchedPatterns === 0) return null;

    return { count, matches };
  };

  // Tool: search_tasks (tasks only)
  mcp.registerTool(
    'search_tasks',
    {
      description: 'Search Mechanic tasks',
      inputSchema: searchInputSchema.omit({ scope: true }),
      outputSchema: searchResponseSchema,
    },
    async (input) => {
      const hits: SearchHit[] = searchStoreAdvanced(getStore(), {
        query: input.query,
        kind: 'task',
        limit: input.limit,
        offset: input.offset,
        fuzzy: input.fuzzy,
        fuzzyMaxEdits: input.fuzzyMaxEdits,
        fuzzyMaxCandidates: input.fuzzyMaxCandidates,
        tags: input.tags,
        subscriptions: input.subscriptions,
      });
      const hitsWithUrl = hits.map((hit) => ({
        ...hit,
        url: `https://tasks.mechanic.dev/${hit.id.replace(/^task:/, '')}`,
        subscriptions: getStore()
          .records.filter((r) => r.id === hit.id && r.kind === 'task')
          .flatMap((r) => ('events' in r ? r.events : [])),
        subscriptions_template: getStore()
          .records.filter((r) => r.id === hit.id && r.kind === 'task')
          .map((r) => ('subscriptions_template' in r ? (r as any).subscriptions_template : undefined))
          .find(Boolean),
        options: getStore()
          .records.filter((r) => r.id === hit.id && r.kind === 'task')
          .map((r) => ('options' in r ? r.options : undefined))
          .find(Boolean),
      }));

      const nextOffset = hits.length === input.limit ? input.offset + input.limit : undefined;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: hitsWithUrl,
                nextOffset,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: {
          items: hitsWithUrl,
          nextOffset,
        },
      };
    },
  );

  // Tool: search_task_examples (tasks only, with script excerpts)
  mcp.registerTool(
    'search_task_examples',
    {
      description: 'Search task library and return code examples (script excerpts + subscriptions/options), with optional pattern matching.',
      inputSchema: taskExamplesInputSchema,
      outputSchema: taskExamplesResponseSchema,
    },
    async (input) => {
      const maxScriptChars = input.maxScriptChars ?? 4000;
      const query = input.query?.trim() || '';
      const pattern = input.pattern?.trim() || '';
      const patternsRaw = (input.patterns || []).map((value) => value.trim()).filter(Boolean);
      const patterns = Array.from(new Set(pattern ? [pattern, ...patternsRaw] : patternsRaw));
      const matchMode = input.matchMode ?? 'any';

      const truncateField = (value?: string | null) => {
        if (!value) return undefined;
        if (value.length > maxScriptChars) return undefined;
        return value;
      };

      const buildItem = (
        record: TaskRecord,
        matchInfo?: { count: number; matches: Array<{ field: 'script' | 'online_store_javascript' | 'order_status_javascript'; index: number; snippet: string; pattern?: string }> },
      ) => {
        const handle = record.slug || record.id.replace(/^task:/, '');
        const url = `https://tasks.mechanic.dev/${handle}`;
        const script = record.script ?? '';
        const scriptTruncated = script.length > maxScriptChars;
        const scriptOut = scriptTruncated ? `${script.slice(0, maxScriptChars)}\n...` : script || undefined;

        return {
          id: record.id,
          title: record.title,
          url,
          tags: record.tags,
          subscriptions: record.events,
          subscriptions_template: record.subscriptions_template,
          options: record.options,
          script: scriptOut,
          script_truncated: scriptTruncated || undefined,
          match_count: matchInfo?.count || undefined,
          matches: matchInfo?.matches.length ? matchInfo.matches : undefined,
          online_store_javascript: truncateField(record.online_store_javascript),
          order_status_javascript: truncateField(record.order_status_javascript),
        };
      };

      const taskRecords = getStore().records.filter((record): record is TaskRecord => record.kind === 'task');
      let items: Array<Record<string, unknown>> = [];
      let nextOffset: number | undefined;

      if (patterns.length === 0) {
        const hits: SearchHit[] = searchStoreAdvanced(getStore(), {
          query,
          kind: 'task',
          limit: input.limit,
          offset: input.offset,
          fuzzy: input.fuzzy,
          fuzzyMaxEdits: input.fuzzyMaxEdits,
          fuzzyMaxCandidates: input.fuzzyMaxCandidates,
          tags: input.tags,
          subscriptions: input.subscriptions,
        });

        items = hits
          .map((hit) => taskRecords.find((record) => record.id === hit.id))
          .filter((record): record is TaskRecord => Boolean(record))
          .map((record) => buildItem(record));

        nextOffset = hits.length === input.limit ? input.offset + input.limit : undefined;
      } else {
        const candidates = query
          ? searchStoreAdvanced(getStore(), {
              query,
              kind: 'task',
              limit: taskRecords.length,
              offset: 0,
              fuzzy: input.fuzzy,
              fuzzyMaxEdits: input.fuzzyMaxEdits,
              fuzzyMaxCandidates: input.fuzzyMaxCandidates,
              tags: input.tags,
              subscriptions: input.subscriptions,
            })
              .map((hit) => taskRecords.find((record) => record.id === hit.id))
              .filter((record): record is TaskRecord => Boolean(record))
          : taskRecords.filter((record) => taskMatchesFilters(record, input.tags, input.subscriptions));

        const withMatches = candidates
          .map((record) => {
            const matchInfo = collectPatternMatchesForPatterns(
              record,
              patterns,
              matchMode,
              input.patternField,
              input.patternCaseSensitive,
              input.maxMatches,
              input.contextChars,
            );
            if (!matchInfo) return null;
            return { record, matchInfo };
          })
          .filter((entry): entry is { record: TaskRecord; matchInfo: { count: number; matches: Array<{ field: 'script' | 'online_store_javascript' | 'order_status_javascript'; index: number; snippet: string; pattern?: string }> } } =>
            Boolean(entry),
          );

        if (!query) {
          withMatches.sort((a, b) => {
            if (b.matchInfo.count !== a.matchInfo.count) {
              return b.matchInfo.count - a.matchInfo.count;
            }
            return a.record.title.localeCompare(b.record.title);
          });
        }

        const paged = withMatches.slice(input.offset, input.offset + input.limit);
        items = paged.map((entry) => buildItem(entry.record, entry.matchInfo));
        nextOffset =
          withMatches.length > input.offset + input.limit ? input.offset + input.limit : undefined;
      }

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items,
                nextOffset,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: taskExamplesResponseSchema.parse({
          items,
          nextOffset,
        }),
      };
    },
  );

  // Tool: search_docs (docs only)
  mcp.registerTool(
    'search_docs',
    {
      description: 'Search Mechanic docs (generated task documentation)',
      inputSchema: searchInputSchema.omit({ scope: true }),
      outputSchema: searchResponseSchema,
    },
    async (input) => {
      const hits: SearchHit[] = searchStoreAdvanced(getStore(), {
        query: input.query,
        kind: 'doc',
        limit: input.limit,
        offset: input.offset,
        fuzzy: input.fuzzy,
        fuzzyMaxEdits: input.fuzzyMaxEdits,
        fuzzyMaxCandidates: input.fuzzyMaxCandidates,
        tags: input.tags,
        subscriptions: input.subscriptions,
      });
      const hitsWithUrl = hits.map((hit) => ({
        ...hit,
        url: `https://learn.mechanic.dev/${hit.path}`,
        sourceUrl: `https://learn.mechanic.dev/${hit.path}`,
      }));

      const nextOffset = hits.length === input.limit ? input.offset + input.limit : undefined;

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(
              {
                items: hitsWithUrl,
                nextOffset,
              },
              null,
              2,
            ),
          },
        ],
        structuredContent: {
          items: hitsWithUrl,
          nextOffset,
        },
      };
    },
  );

  // Tool: get_task (full payload)
  mcp.registerTool(
    'get_task',
    {
      description: 'Tasks only: fetch by handle/id with full payload (script, options, subscriptions).',
      inputSchema: z.object({ id: taskIdSchema }),
      outputSchema: taskDetailSchema,
    },
    async (input) => {
      const normalizedId = input.id.startsWith('task:') ? input.id : `task:${input.id}`;
      const record = getStore().records.find((r) => r.id === normalizedId);
      if (!record || record.kind !== 'task') {
        return {
          content: [{ type: 'text', text: `Task not found or not a task: ${input.id}` }],
          isError: true,
          structuredContent: undefined,
        };
      }

      const handle = record.slug || record.id.replace(/^task:/, '');
      const url = `https://tasks.mechanic.dev/${handle}`;
      const subscriptions = record.events || [];

      // The task JSON isn't stored wholesale; we surface what we have
      const detail = {
        id: record.id,
        handle,
        name: record.title,
        tags: record.tags,
        url,
        subscriptions,
        subscriptions_template: record.subscriptions_template,
        options: record.options,
        script: record.script,
        online_store_javascript: record.online_store_javascript || undefined,
        order_status_javascript: record.order_status_javascript || undefined,
      };

      return {
        content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
        structuredContent: taskDetailSchema.parse(detail),
      };
    },
  );

  // Tool: similar_tasks
  mcp.registerTool(
    'similar_tasks',
    {
      description: 'Find similar tasks by tags/subscriptions/title content.',
      inputSchema: similarTasksInputSchema,
      outputSchema: similarTasksResponseSchema,
    },
    async (input) => {
      const allTasks = getStore().records.filter((r) => r.kind === 'task');
      const target = allTasks.find((r) => r.id === input.handle || r.id === `task:${input.handle}` || r.slug === input.handle);
      if (!target) {
        return {
          content: [{ type: 'text', text: `Task not found: ${input.handle}` }],
          structuredContent: undefined,
        };
      }

      const targetTags = new Set((target.tags || []).map((t) => t.toLowerCase()));
      const targetSubs = new Set((target.events || []).map((s) => s.toLowerCase()));
      const targetTitle = target.title.toLowerCase();

      const scored: Array<{ r: RecordItem; score: number }> = [];

      allTasks.forEach((r) => {
        if (r.id === target.id) return;
        let score = 0;
        const tagsLower = (r.tags || []).map((t) => t.toLowerCase());
        tagsLower.forEach((t) => {
          if (targetTags.has(t)) score += 2;
        });
        const subsLower = (r.events || []).map((s) => s.toLowerCase());
        subsLower.forEach((s) => {
          if (targetSubs.has(s)) score += 1;
        });
        if (targetTitle && r.title.toLowerCase().includes(targetTitle.split(' ')[0] || '')) {
          score += 0.5;
        }
        if (score > 0) {
          scored.push({ r, score });
        }
      });

      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, input.limit).map(({ r }) => {
        const handle = (r as any).slug || r.id.replace(/^task:/, '');
        return {
          id: r.id,
          kind: r.kind,
          title: r.title,
          path: r.path,
          url: `https://tasks.mechanic.dev/${handle}`,
          snippet: r.kind === 'task' ? (r as any).summary || '' : '',
          tags: r.tags,
          score: 0,
        };
      });

      return {
        content: [{ type: 'text', text: JSON.stringify({ items: top }, null, 2) }],
        structuredContent: { items: top },
      };
    },
  );

  // Tool: lint_task (HTTP)
  mcp.registerTool(
    'build_task_export',
    {
      description: 'Build a canonical Mechanic task export from partial fields (script, subscriptions, options).',
      inputSchema: buildTaskExportInputSchema,
      outputSchema: buildTaskExportResponseSchema,
    },
    async (input) => {
      const task = buildTaskExportPayload(input.task as Record<string, unknown>);
      const warnings: string[] = [];

      if (!task.script && !task.online_store_javascript && !task.order_status_javascript) {
        warnings.push('No script or JS present; export may be incomplete.');
      }

      if (
        !task.subscriptions_template &&
        (!Array.isArray(task.subscriptions) || task.subscriptions.length === 0) &&
        (!Array.isArray(task.preview_event_definitions) || task.preview_event_definitions.length === 0)
      ) {
        warnings.push('No subscriptions or preview events present; preview_task will fail.');
      }

      const payload = buildTaskExportResponseSchema.parse({
        task,
        warnings: warnings.length > 0 ? warnings : undefined,
      });

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  );

  // Tool: lint_task (HTTP)
  mcp.registerTool(
    'lint_task',
    {
      description: 'Validate a Mechanic task without running a preview (requires MECHANIC_API_BASE and MECHANIC_TOOL_TOKEN).',
      inputSchema: lintTaskInputSchema,
      outputSchema: lintTaskResponseSchema,
    },
    async (input) => {
      try {
        const task = normalizeTaskPayload(input.task as Record<string, unknown>);
        const result = await callMechanicApi('/api/tasks/lint', { task });
        const parsed = lintTaskResponseSchema.parse(result);

        return {
          content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
          structuredContent: parsed,
        };
      } catch (error) {
        const normalizedError = normalizeApiError(error);
        const payload = lintTaskResponseSchema.parse({
          valid: false,
          errors: null,
          task: {},
          error: normalizedError,
        });
        return {
          content: [{ type: 'text', text: `Lint failed: ${normalizedError.message}` }],
          isError: true,
          structuredContent: payload,
        };
      }
    },
  );

  // Tool: preview_task (HTTP)
  mcp.registerTool(
    'preview_task',
    {
      description: 'Run a dry preview of a Mechanic task (requires MECHANIC_API_BASE and MECHANIC_TOOL_TOKEN).',
      inputSchema: previewTaskInputSchema,
      outputSchema: previewTaskResponseSchema,
    },
    async (input) => {
      try {
        const task = normalizeTaskPayload(input.task as Record<string, unknown>);
        if (!hasPreviewInputs(task)) {
          const errorPayload = previewTaskResponseSchema.parse({
            errors: null,
            task: {},
            events: [],
            error: {
              code: 'preview_requires_subscriptions',
              message:
                'Preview requires subscriptions/subscriptions_template or preview_event_definitions.',
              hint: 'Provide subscriptions or preview_event_definitions, or use lint_task for script-only work.',
            },
          });
          return {
            content: [
              {
                type: 'text',
                text:
                  'Preview requires subscriptions/subscriptions_template or preview_event_definitions. ' +
                  'For script-only work, use lint_task first or provide a full task export.',
              },
            ],
            isError: true,
            structuredContent: errorPayload,
          };
        }

        const result = await callMechanicApi('/api/tasks/preview', { task });
        const parsed = previewTaskResponseSchema.parse(result);

        return {
          content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }],
          structuredContent: parsed,
        };
      } catch (error) {
        const normalizedError = normalizeApiError(error);
        const payload = previewTaskResponseSchema.parse({
          errors: null,
          task: {},
          events: [],
          error: normalizedError,
        });
        return {
          content: [{ type: 'text', text: `Preview failed: ${normalizedError.message}` }],
          isError: true,
          structuredContent: payload,
        };
      }
    },
  );

  // Tool: list_tasks (metadata only)
  mcp.registerTool(
    'list_tasks',
    {
      description: 'List library tasks with minimal metadata (title, subscriptions, options, tags).',
      inputSchema: taskListInputSchema,
      outputSchema: taskListResponseSchema,
    },
    async (input) => {
      const tasks = getStore().records.filter((r) => r.kind === 'task');
      const limit = input.limit ?? 25;
      const tagsLower = (input.tags || []).map((t) => t.toLowerCase());
      const subsLower = (input.subscriptions || []).map((s) => s.toLowerCase());

      const filtered = tasks.filter((task) => {
        const taskTags = (task.tags || []).map((t) => t.toLowerCase());
        const taskSubs = (task.events || []).map((s) => s.toLowerCase());

        const tagsMatch = tagsLower.length === 0 || tagsLower.every((tag) => taskTags.includes(tag));
        const subsMatch = subsLower.length === 0 || subsLower.every((sub) => taskSubs.includes(sub));
        return tagsMatch && subsMatch;
      });

      const items = filtered.slice(0, limit).map((task) => ({
        id: task.id,
        title: task.title,
        url: task.path,
        tags: task.tags,
        subscriptions: task.events || [],
        subscriptions_template: (task as any).subscriptions_template,
        options: (task as any).options,
      }));

      const payload = { items };

      return {
        content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
        structuredContent: taskListResponseSchema.parse(payload),
      };
    },
  );

  // Tool: get_doc (docs only)
  mcp.registerTool(
    'get_doc',
    {
      description: 'Docs only: fetch by id/path (use search_docs to find ids).',
      inputSchema: z.object({ id: docIdSchema }),
      outputSchema: docDetailSchema,
    },
    async (input) => {
      const normalizedId = input.id.startsWith('doc:') ? input.id : `doc:${input.id}`;
      const record = getStore().records.find((r) => r.id === normalizedId);
      if (!record || record.kind !== 'doc') {
        return {
          content: [{ type: 'text', text: `Doc not found or not a doc: ${input.id}` }],
          isError: true,
          structuredContent: undefined,
        };
      }
      const detail = {
        id: record.id,
        title: record.title,
        path: record.path,
        url: record.sourceUrl,
        content: record.content,
      };
      return {
        content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }],
        structuredContent: docDetailSchema.parse(detail),
      };
    },
  );

  // Doc resources only
  const docResources: Resource[] = getStore()
    .records.filter((r) => r.kind === 'doc')
    .map((doc) => {
      const uri = `mechanic-docs://${encodeUri(doc.id)}`;
      return {
        uri,
        name: doc.title,
        description: (doc as any).sourceUrl || doc.path,
        mimeType: 'text/markdown',
      };
    });

  docResources.forEach((res) => {
    mcp.registerResource(
      res.name,
      res.uri,
      {
        description: res.description,
        mimeType: res.mimeType,
      },
      async () => {
        const decodedId = decodeUri(res.uri.replace(/^mechanic-docs:\/\//, ''));
        const record = getStore().records.find((r) => r.id === decodedId);
        if (!record || record.kind !== 'doc') {
          return { contents: [] };
        }
        return {
          contents: [
            {
              uri: res.uri,
              mimeType: 'text/markdown',
              text: record.content,
            },
          ],
        };
      },
    );
  });

  // Tool: refresh_index
  mcp.registerTool(
    'refresh_index',
    {
      description: 'Refresh and rebuild the index from source data',
      inputSchema: z.object({}),
    },
    async () => {
      await refresh();
      return { content: [{ type: 'text', text: 'Refreshed index' }] };
    },
  );

  const transport = new StdioServerTransport();
  await mcp.connect(transport);

  const currentStore = getStore();
  const docCount = currentStore.records.filter((item: RecordItem) => item.kind === 'doc').length;
  const taskCount = currentStore.records.filter((item: RecordItem) => item.kind === 'task').length;

  console.error(`MCP server ready (docs=${docCount}, tasks=${taskCount}) on stdio`);

  return async () => {
    await mcp.close();
    transport.close();
    console.error('MCP server stopped.');
  };
}
