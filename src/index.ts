#!/usr/bin/env node
import path from 'node:path';
import fs from 'node:fs';
import { loadConfig } from './config.js';
import { hydrateStore, loadPrebuiltIndex, loadBundledRecords } from './core/engine.js';
import { syncRepo } from './core/git.js';
import { startMcpServer } from './mcp/server.js';

async function bootstrap() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    console.log('Usage: mechanic-mcp (runs MCP server on stdio)');
    console.log('Environment: MECHANIC_DATA_PATH (defaults to dist/data with bundled index/records).');
    console.log('Tools: search_tasks, search_docs, get_task, get_doc, similar_tasks, refresh_index.');
    process.exit(0);
  }

  const config = loadConfig();

  // Keep a mutable reference so refresh can swap it.
  const prebuiltIndex = loadPrebuiltIndex(config.dataDir);
  const bundledRecords = await loadBundledRecords(config.dataDir);
  let store = await hydrateStore(config, prebuiltIndex, bundledRecords);

  const refresh = async () => {
    // If we have bundled records, skip repo sync; otherwise sync and rebuild.
    if (!bundledRecords) {
      await Promise.all([syncRepo(config.docs), syncRepo(config.tasks)]);
      store = await hydrateStore(config, prebuiltIndex, bundledRecords);
    }
  };

  // Initial sync happens before serving.
  await refresh();

  // Background sync.
  const intervalMs = config.syncIntervalMinutes * 60 * 1000;
  const timer = setInterval(() => {
    refresh().catch((error) => {
      console.error('Periodic refresh failed', error);
    });
  }, intervalMs);

  const stop = await startMcpServer({
    getStore: () => store,
    refresh,
  });

  // Log manifest info if present
  const manifestPath = path.join(config.dataDir, 'manifest.json');
  if (fs.existsSync(manifestPath)) {
    try {
      const manifestRaw = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestRaw);
      console.error('Data manifest', manifest);
    } catch (error) {
      console.error(`Unable to read manifest at ${manifestPath}: ${error}`);
    }
  }

  const shutdown = async () => {
    clearInterval(timer);
    await stop();
  };

  const handleSignal = async (signal: string) => {
    console.error(`Received ${signal}, shutting down...`);
    await shutdown();
    process.exit(0);
  };

  process.on('SIGINT', handleSignal);
  process.on('SIGTERM', handleSignal);

  return { shutdown };
}

bootstrap().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
