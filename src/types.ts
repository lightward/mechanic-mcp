export type ResourceKind = 'doc' | 'task';

export interface DocRecord {
  id: string;
  kind: 'doc';
  title: string;
  path: string;
  section?: string;
  tags: string[];
  headings: string[];
  content: string;
  sourceUrl?: string;
}

export interface TaskRecord {
  id: string;
  kind: 'task';
  slug: string;
  title: string;
  path: string; // absolute or repo-relative path to the JSON file
  summary?: string;
  tags: string[];
  events: string[];
  actions: string[];
  scopes: string[];
  risk: 'read' | 'write' | 'mixed' | 'unknown';
  content: string;
  options?: Record<string, unknown>;
  script?: string;
  online_store_javascript?: string | null;
  order_status_javascript?: string | null;
  subscriptions_template?: string;
}

export type RecordItem = DocRecord | TaskRecord;

export interface SearchHit {
  id: string;
  kind: ResourceKind;
  title: string;
  path: string;
  snippet: string;
  tags: string[];
  score: number;
}
