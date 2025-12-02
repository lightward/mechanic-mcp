import { strict as assert } from 'node:assert';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from '../config.js';
import { hydrateStore, loadPrebuiltIndex, loadBundledRecords } from '../core/engine.js';

async function main() {
  const config = loadConfig();
  const prebuilt = loadPrebuiltIndex(config.dataDir);
  const records = await loadBundledRecords(config.dataDir);
  const store = await hydrateStore(config, prebuilt, records);

  assert(store.records.some((r) => r.kind === 'doc'), 'Expected docs in bundled records');

  // eslint-disable-next-line no-console
  console.log('Doc resource smoke passed.');
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
