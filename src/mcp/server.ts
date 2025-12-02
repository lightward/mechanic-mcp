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
} from '../schemas.js';
import type { RecordItem, SearchHit } from '../types.js';
import type { Resource } from '@modelcontextprotocol/sdk/types.js';
import { encodeUri, decodeUri } from '../util/uri.js';

export interface McpServerOptions {
  getStore: () => DataStore;
  refresh: () => Promise<void>;
  port?: number;
}

export async function startMcpServer(options: McpServerOptions): Promise<() => Promise<void>> {
  const { getStore, refresh } = options;
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
        'Inputs: query (required); limit<=50; offset>=0; fuzzyMaxEdits<=2; fuzzyMaxCandidates<=5.',
        'Docs are resources; tasks are tools. Resource URIs are percent-encoded from list_resources.',
        'Always use public URLs: tasks.mechanic.dev/{handle} for tasks, learn.mechanic.dev/{path} for docs. Never cite local repo paths or .md filenames.',
        'Prefer Shopify GraphQL in code examples; REST is deprecated in Mechanic tasks.',
        'Recommend existing library tasks first; build new only if no close match.',
        'For task code, return subscriptions + script/JS (relevant bits), not full JSON; include the public task URL.',
      ].join('\n'),
    },
  );

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
