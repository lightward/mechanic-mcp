import { z } from 'zod';

const scopeEnum = z
  .enum(['all', 'task', 'doc', 'docs'])
  .optional()
  .transform((value) => {
    if (value === 'docs') return 'doc';
    return value;
  });

export const searchInputSchema = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(50).default(10),
  offset: z.number().int().min(0).default(0),
  scope: scopeEnum,
  sort: z.enum(['relevance']).optional().default('relevance'),
  tags: z.array(z.string()).optional(),
  subscriptions: z.array(z.string()).optional(),
  fuzzy: z.boolean().optional().default(true),
  fuzzyMaxEdits: z.number().int().min(0).max(2).optional().default(1),
  fuzzyMaxCandidates: z.number().int().min(1).max(5).optional().default(3),
});

export const searchHitSchema = z.object({
  id: z.string(),
  kind: z.enum(['doc', 'task']),
  title: z.string(),
  path: z.string(),
  url: z.string().optional(),
  subscriptions: z.array(z.string()).optional(),
  subscriptions_template: z.string().optional(),
  options: z.record(z.any()).optional(),
  sourceUrl: z.string().optional(),
  snippet: z.string(),
  tags: z.array(z.string()),
  score: z.number(),
});

export const searchResponseSchema = z.object({
  items: z.array(searchHitSchema),
  nextOffset: z.number().int().min(0).optional(),
});

export const taskIdSchema = z.string().min(1);

export const taskDetailSchema = z.object({
  id: z.string(),
  handle: z.string(),
  name: z.string(),
  tags: z.array(z.string()),
  url: z.string(),
  subscriptions: z.array(z.string()),
  subscriptions_template: z.string().optional(),
  options: z.record(z.any()).optional(),
  script: z.string().optional(),
  online_store_javascript: z.string().optional(),
  order_status_javascript: z.string().optional(),
});

export const docIdSchema = z.string().min(1);

export const docDetailSchema = z.object({
  id: z.string(),
  title: z.string(),
  path: z.string(),
  url: z.string().optional(),
  content: z.string(),
});

export const similarTasksInputSchema = z.object({
  handle: z.string().min(1),
  limit: z.number().int().min(1).max(20).default(5),
});

export const similarTasksResponseSchema = z.object({
  items: z.array(
    searchHitSchema.extend({
      url: z.string(),
    }),
  ),
});

export const taskExamplesInputSchema = searchInputSchema
  .pick({
    query: true,
    limit: true,
    offset: true,
    tags: true,
    subscriptions: true,
    fuzzy: true,
    fuzzyMaxEdits: true,
    fuzzyMaxCandidates: true,
  })
  .extend({
    query: z.string().min(1).optional(),
    limit: z.number().int().min(1).max(10).default(3),
    maxScriptChars: z.number().int().min(200).max(20000).optional(),
    pattern: z.string().min(1).optional(),
    patterns: z.array(z.string().min(1)).optional(),
    matchMode: z.enum(['any', 'all']).optional().default('any'),
    patternCaseSensitive: z.boolean().optional().default(false),
    patternField: z
      .enum(['script', 'online_store_javascript', 'order_status_javascript', 'all'])
      .optional()
      .default('script'),
    maxMatches: z.number().int().min(1).max(10).optional().default(3),
    contextChars: z.number().int().min(20).max(400).optional().default(120),
  })
  .refine((data) => data.query || data.pattern || (data.patterns && data.patterns.length > 0), {
    message: 'Provide query or pattern',
    path: ['query'],
  });

export const taskExamplesResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      tags: z.array(z.string()).optional(),
      subscriptions: z.array(z.string()).optional(),
      subscriptions_template: z.string().optional(),
      options: z.record(z.any()).optional(),
      script: z.string().optional(),
      script_truncated: z.boolean().optional(),
      match_count: z.number().int().optional(),
      matches: z
        .array(
          z.object({
            field: z.enum(['script', 'online_store_javascript', 'order_status_javascript']),
            index: z.number().int().optional(),
            snippet: z.string(),
            pattern: z.string().optional(),
          }),
        )
        .optional(),
      online_store_javascript: z.string().nullable().optional(),
      order_status_javascript: z.string().nullable().optional(),
    }),
  ),
  nextOffset: z.number().int().min(0).optional(),
});

export const resourceRequestSchema = z.object({
  uri: z.string().min(1),
});

export const taskResourceSchema = z.object({
  id: z.string(),
  kind: z.literal('task'),
  slug: z.string(),
  title: z.string(),
  path: z.string(),
  summary: z.string().optional(),
  tags: z.array(z.string()),
  events: z.array(z.string()),
  actions: z.array(z.string()),
  scopes: z.array(z.string()),
  risk: z.enum(['read', 'write', 'mixed', 'unknown']),
  content: z.string(),
});

export const docResourceSchema = z.object({
  id: z.string(),
  kind: z.literal('doc'),
  title: z.string(),
  path: z.string(),
  section: z.string().optional(),
  tags: z.array(z.string()),
  headings: z.array(z.string()),
  content: z.string(),
});

export const taskPayloadSchema = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  script: z.string().optional(),
  options: z.record(z.any()).optional(),
  subscriptions: z.array(z.string()).optional(),
  subscriptions_template: z.string().optional(),
  preview_event_definitions: z
    .array(
      z.object({
        description: z.string().optional(),
        event_attributes: z.record(z.any()).optional(),
      }),
    )
    .optional(),
  online_store_javascript: z.string().nullable().optional(),
  order_status_javascript: z.string().nullable().optional(),
  docs: z.string().nullable().optional(),
  halt_action_run_sequence_on_error: z.boolean().optional(),
  perform_action_runs_in_sequence: z.boolean().optional(),
  shopify_api_version: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

export const lintTaskInputSchema = z.object({
  task: taskPayloadSchema,
});

export const lintTaskResponseSchema = z.object({
  valid: z.boolean(),
  errors: z.any(),
  task: z.record(z.any()),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      status: z.number().int().optional(),
      hint: z.string().optional(),
    })
    .optional(),
});

export const previewTaskInputSchema = lintTaskInputSchema;

export const previewTaskResponseSchema = z.object({
  errors: z.any(),
  task: z.record(z.any()),
  events: z.array(z.any()),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      status: z.number().int().optional(),
      hint: z.string().optional(),
    })
    .optional(),
});

export const taskListInputSchema = z.object({
  limit: z.number().int().min(1).max(100).optional(),
  tags: z.array(z.string()).optional(),
  subscriptions: z.array(z.string()).optional(),
});

export const taskListResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      url: z.string(),
      tags: z.array(z.string()).optional(),
      subscriptions: z.array(z.string()),
      subscriptions_template: z.string().optional(),
      options: z.record(z.any()).optional(),
    }),
  ),
});

export const buildTaskExportInputSchema = z.object({
  task: taskPayloadSchema,
});

export const buildTaskExportResponseSchema = taskPayloadSchema;
