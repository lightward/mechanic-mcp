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
