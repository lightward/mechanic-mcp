import type { RecordItem, ResourceKind, SearchHit } from '../types.js';

export interface BuiltIndex {
  documents: IndexedDocument[];
  docFreq: Record<string, number>;
  totalDocuments: number;
}

interface IndexedDocument {
  id: string;
  kind: ResourceKind;
  path: string;
  tags: string[];
  fieldText: Record<string, string>;
  tokenFreq: Record<string, Record<string, number>>;
  raw: RecordItem;
}

const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'for',
  'from',
  'in',
  'of',
  'on',
  'or',
  'the',
  'to',
  'with',
]);

const FIELD_CONFIG: Record<
  string,
  {
    weight: number;
    extractor: (item: RecordItem) => string;
  }
> = {
  title: {
    weight: 5,
    extractor: (item) => item.title,
  },
  tags: {
    weight: 3.5,
    extractor: (item) => item.tags.join(' '),
  },
  content: {
    weight: 1.5,
    extractor: (item) => item.content,
  },
  slug: {
    weight: 4,
    extractor: (item) => (item.kind === 'task' ? item.slug : ''),
  },
  headings: {
    weight: 3,
    extractor: (item) => (item.kind === 'doc' ? item.headings.join(' ') : ''),
  },
  section: {
    weight: 2,
    extractor: (item) => (item.kind === 'doc' ? item.section ?? '' : ''),
  },
  events: {
    weight: 2,
    extractor: (item) => (item.kind === 'task' ? item.events.join(' ') : ''),
  },
  actions: {
    weight: 2,
    extractor: (item) => (item.kind === 'task' ? item.actions.join(' ') : ''),
  },
  scopes: {
    weight: 2,
    extractor: (item) => (item.kind === 'task' ? item.scopes.join(' ') : ''),
  },
};

function normalizeText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (Array.isArray(value)) return value.join(' ');
  return String(value);
}

function tokenize(text: string): string[] {
  return normalizeText(text)
    .toLowerCase()
    .replace(/[_/]+/g, ' ')
    .split(/[^a-z0-9]+/g)
    .filter(Boolean)
    .filter((token) => !STOP_WORDS.has(token));
}

function countTokens(text: string): Record<string, number> {
  return tokenize(text).reduce<Record<string, number>>((counts, token) => {
    counts[token] = (counts[token] || 0) + 1;
    return counts;
  }, {});
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const dp = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1));

  for (let i = 0; i <= a.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= b.length; j += 1) dp[0][j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }

  return dp[a.length][b.length];
}

function indexRecord(item: RecordItem): IndexedDocument {
  const fieldText: Record<string, string> = {};
  const tokenFreq: Record<string, Record<string, number>> = {};

  Object.entries(FIELD_CONFIG).forEach(([field, config]) => {
    const text = normalizeText(config.extractor(item));
    fieldText[field] = text;
    tokenFreq[field] = countTokens(text);
  });

  return {
    id: item.id,
    kind: item.kind,
    path: item.path,
    tags: item.tags,
    fieldText,
    tokenFreq,
    raw: item,
  };
}

function buildDocFrequency(indexed: IndexedDocument[]): Record<string, number> {
  const docFreq: Record<string, number> = {};
  indexed.forEach((doc) => {
    const seen = new Set<string>();
    Object.values(doc.tokenFreq).forEach((fieldTokens) => {
      Object.keys(fieldTokens).forEach((token) => seen.add(token));
    });
    seen.forEach((token) => {
      docFreq[token] = (docFreq[token] || 0) + 1;
    });
  });
  return docFreq;
}

export function buildIndex(records: RecordItem[]): BuiltIndex {
  const docs = records.map(indexRecord);
  const docFreq = buildDocFrequency(docs);
  return {
    documents: docs,
    docFreq,
    totalDocuments: docs.length,
  };
}

interface TokenCandidate {
  queryToken: string;
  candidates: Array<{ token: string; distance: number; weight: number }>;
}

function fuzzyMatchToken(
  token: string,
  docFreq: Record<string, number>,
  maxEdits: number,
  limit: number,
): TokenCandidate['candidates'] {
  const vocabulary = Object.keys(docFreq);
  const candidates: TokenCandidate['candidates'] = [];

  for (const vocabToken of vocabulary) {
    const distance = levenshtein(token, vocabToken);
    if (distance > maxEdits) continue;
    const weight = distance === 0 ? 1 : distance === 1 ? 0.6 : 0.3;
    candidates.push({ token: vocabToken, distance, weight });
  }

  if (!candidates.find((c) => c.distance === 0)) {
    candidates.push({ token, distance: 0, weight: 1 });
  }

  candidates.sort((a, b) => {
    if (a.distance !== b.distance) return a.distance - b.distance;
    return (docFreq[b.token] || 0) - (docFreq[a.token] || 0);
  });

  return candidates.slice(0, limit);
}

function buildTokenCandidates(
  tokens: string[],
  docFreq: Record<string, number>,
  fuzzy: boolean,
  maxEdits: number,
  maxCandidates: number,
): TokenCandidate[] {
  return tokens.map((token) => ({
    queryToken: token,
    candidates: fuzzy
      ? fuzzyMatchToken(token, docFreq, maxEdits, maxCandidates)
      : [{ token, distance: 0, weight: 1 }],
  }));
}

function scoreDocument(
  doc: IndexedDocument,
  tokenCandidates: TokenCandidate[],
  built: BuiltIndex,
  kind?: ResourceKind,
): { score: number; matches: Array<{ field: string; token: string }> } | null {
  if (kind && doc.kind !== kind) {
    return null;
  }

  const { docFreq, totalDocuments } = built;
  let score = 0;
  const matches: Array<{ field: string; token: string }> = [];

  tokenCandidates.forEach(({ candidates }) => {
    candidates.forEach(({ token, weight }) => {
      const idf = Math.log(1 + totalDocuments / (1 + (docFreq[token] || 0)));

      Object.entries(doc.tokenFreq).forEach(([field, freqMap]) => {
        const freq = freqMap[token] || 0;
        if (freq === 0) return;
        const fieldWeight = FIELD_CONFIG[field]?.weight ?? 1;
        const fieldScore = freq * fieldWeight * idf * weight;
        score += fieldScore;
        matches.push({ field, token });
      });
    });
  });

  if (tokenCandidates.length > 0 && score === 0) {
    return null;
  }

  return { score, matches };
}

function buildSnippet(text: string | undefined, queryTokens: string[], length = 200): string {
  if (!text) return '';
  const lower = text.toLowerCase();
  for (const token of queryTokens) {
    const idx = lower.indexOf(token);
    if (idx !== -1) {
      const start = Math.max(0, idx - Math.floor(length / 2));
      const end = Math.min(text.length, start + length);
      const prefix = start > 0 ? '…' : '';
      const suffix = end < text.length ? '…' : '';
      return `${prefix}${text.slice(start, end).trim()}${suffix}`;
    }
  }
  return text.slice(0, length).trim();
}

function buildDocSnippet(item: RecordItem, queryTokens: string[]): string {
  if (item.kind === 'doc') {
    const heading = item.headings[0] || item.title;
    const excerpt = buildSnippet(item.content, queryTokens);
    return `${heading}: ${excerpt}`;
  }
  // For tasks, use docs content if present as intro
  return buildSnippet(item.content, queryTokens);
}

function parseQuery(query: string): string[] {
  return tokenize(query);
}

export interface SearchOptions {
  query: string;
  kind?: ResourceKind;
  limit?: number;
  offset?: number;
  fuzzy?: boolean;
  fuzzyMaxEdits?: number;
  fuzzyMaxCandidates?: number;
  tags?: string[];
  subscriptions?: string[];
}

export function searchAdvanced(built: BuiltIndex, options: SearchOptions): SearchHit[] {
  const {
    query,
    kind,
    limit = 10,
    offset = 0,
    fuzzy = true,
    fuzzyMaxEdits = 1,
    fuzzyMaxCandidates = 3,
    tags,
    subscriptions,
  } = options;

  const tokens = parseQuery(query);
  const tokenCandidates = buildTokenCandidates(tokens, built.docFreq, fuzzy, fuzzyMaxEdits, fuzzyMaxCandidates);
  const snippetTokens = tokenCandidates.flatMap((t) => t.candidates.map((c) => c.token));

  const scored: Array<{ doc: IndexedDocument; score: number; matches: Array<{ field: string; token: string }> }> =
    [];

  built.documents.forEach((doc) => {
    if (tags && tags.length > 0) {
      const docTags = (doc.raw.kind === 'task' ? doc.raw.tags : doc.tags) || [];
      const lower = docTags.map((t) => t.toLowerCase());
      const hasAll = tags.every((t) => lower.includes(t.toLowerCase()));
      if (!hasAll) return;
    }

    if (subscriptions && subscriptions.length > 0 && doc.raw.kind === 'task') {
      const subs = (doc.raw.events || []).map((s) => s.toLowerCase()).join(' ');
      const templates = (doc.raw.subscriptions_template || '').toLowerCase();
      const combined = `${subs} ${templates}`;
      const hasAllSubs = subscriptions.every((s) => combined.includes(s.toLowerCase()));
      if (!hasAllSubs) return;
    }

    const scoredDoc = scoreDocument(doc, tokenCandidates, built, kind);
    if (!scoredDoc) return;
    scored.push({ doc, score: scoredDoc.score, matches: scoredDoc.matches });
  });

  scored.sort((a, b) => b.score - a.score);

  return scored.slice(offset, offset + limit).map(({ doc, score }) => ({
    id: doc.id,
    kind: doc.kind,
    title: doc.raw.title,
    path: doc.path,
    snippet: buildDocSnippet(doc.raw, snippetTokens),
    tags: doc.tags,
    score,
  }));
}
