import { strict as assert } from 'node:assert';
import { loadConfig } from '../config.js';
import { hydrateStore, loadPrebuiltIndex, loadBundledRecords } from '../core/engine.js';

async function main() {
  const config = loadConfig();
  const prebuilt = loadPrebuiltIndex(config.dataDir);
  const bundled = await loadBundledRecords(config.dataDir);
  const store = await hydrateStore(config, prebuilt, bundled);

  const taskId = 'task:abandoned-checkout-emails';
  const task = store.records.find((r) => r.id === taskId);
  assert(task && task.kind === 'task', 'Expected abandoned-checkout-emails task');
  assert((task as any).subscriptions_template, 'Expected subscriptions_template');
  assert((task as any).script || (task as any).content, 'Expected script/content');

  console.log('get_task smoke passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
