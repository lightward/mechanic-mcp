import { strict as assert } from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig } from '../config.js';
import { hydrateStore, loadPrebuiltIndex, searchStoreAdvanced } from '../core/engine.js';
import type { ResourceKind } from '../types.js';

async function run() {
  const config = loadConfig();
  const prebuilt = loadPrebuiltIndex(config.dataDir);
  const store = await hydrateStore(config, prebuilt);

  const searchAndAssert = (query: string, kind?: ResourceKind) => {
    const hits = searchStoreAdvanced(store, {
      query,
      kind,
      limit: 3,
      fuzzy: true,
    });
    assert(hits.length > 0, `Expected hits for query "${query}"`);
    return hits;
  };

  // Task search
  const taskHits = searchAndAssert('abandoned checkout', 'task');
  const taskIds = taskHits.map((h) => h.id);
  assert(taskIds.some((id) => id.includes('abandoned')), 'Expected an abandoned checkout task');

  // Doc search
  const docHits = searchAndAssert('subscription', 'doc');
  assert(docHits.some((h) => h.id.startsWith('doc:')), 'Expected doc hits');

  // Filter-only via kind and pagination
  const paged = searchStoreAdvanced(store, {
    query: 'checkout',
    kind: 'task',
    limit: 1,
    offset: 1,
  });
  assert(paged.length === 1, 'Expected one result on paged query');

  // Manifest existence
  const manifestPath = path.join(config.dataDir, 'manifest.json');
  assert(fs.existsSync(manifestPath), 'Manifest should exist');

  // eslint-disable-next-line no-console
  console.log('Smoke tests passed.');
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
