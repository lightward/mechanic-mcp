import { loadDocs } from './docs.js';
import { loadTasks } from './tasks.js';
import { buildIndex, searchAdvanced, type BuiltIndex } from './indexer.js';
import type { ServerConfig } from '../config.js';
import type { RecordItem, ResourceKind, SearchHit } from '../types.js';
import { gunzipSync } from 'node:zlib';
import fs from 'node:fs';
import path from 'node:path';

export interface DataStore {
  records: RecordItem[];
  index: BuiltIndex;
  lastIndexed: Date;
}

async function loadRecordsFromBundle(dataDir: string): Promise<RecordItem[] | null> {
  try {
    const recordsPath = path.join(dataDir, 'records.json.gz');
    const raw = fs.readFileSync(recordsPath);
    const json = gunzipSync(raw).toString('utf-8');
    return JSON.parse(json) as RecordItem[];
  } catch (error) {
    return null;
  }
}

export async function hydrateStore(
  config: ServerConfig,
  prebuiltIndex?: BuiltIndex | null,
  bundledRecords?: RecordItem[] | null,
): Promise<DataStore> {
  const records =
    bundledRecords ||
    (await (async () => {
      const [docs, tasks] = await Promise.all([loadDocs(config.docs.localPath), loadTasks(config.tasks.localPath)]);
      return [...docs, ...tasks];
    })());

  const index = prebuiltIndex || buildIndex(records);

  return {
    records,
    index,
    lastIndexed: new Date(),
  };
}

export function searchStore(store: DataStore, query: string, kind?: ResourceKind, limit?: number): SearchHit[] {
  return searchAdvanced(store.index, {
    query,
    kind,
    limit,
  });
}

export function searchStoreAdvanced(
  store: DataStore,
  options: Parameters<typeof searchAdvanced>[1],
): SearchHit[] {
  return searchAdvanced(store.index, options);
}

export function loadPrebuiltIndex(dataDir: string): BuiltIndex | null {
  try {
    const indexPath = path.join(dataDir, 'index.json.gz');
    const raw = fs.readFileSync(indexPath);
    const json = gunzipSync(raw).toString('utf-8');
    return JSON.parse(json) as BuiltIndex;
  } catch (error) {
    // eslint-disable-next-line no-console
    console.warn(`Failed to load prebuilt index from ${dataDir}: ${error}`);
    return null;
  }
}

export async function loadBundledRecords(dataDir: string): Promise<RecordItem[] | null> {
  const records = await loadRecordsFromBundle(dataDir);
  if (!records) {
    console.warn(`No bundled records found in ${dataDir}`);
  }
  return records;
}
