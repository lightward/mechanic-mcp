import fs from 'node:fs/promises';
import path from 'node:path';
import { gzipSync } from 'node:zlib';
import { loadConfig } from '../src/config';
import { loadDocs } from '../src/core/docs';
import { loadTasks } from '../src/core/tasks';
import { buildIndex } from '../src/core/indexer';

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function main() {
  const config = loadConfig();
  const docs = await loadDocs(config.docs.localPath);
  const tasks = await loadTasks(config.tasks.localPath);

  const combinedIndex = buildIndex([...docs, ...tasks]);

  const dataDir = path.join(process.cwd(), 'dist', 'data');
  await ensureDir(dataDir);

  const indexPath = path.join(dataDir, 'index.json.gz');
  const recordsPath = path.join(dataDir, 'records.json.gz');
  const manifestPath = path.join(dataDir, 'manifest.json');

  const serialized = JSON.stringify(combinedIndex);
  const gz = gzipSync(serialized);
  await fs.writeFile(indexPath, gz);

  const serializedRecords = JSON.stringify([...docs, ...tasks]);
  const gzRecords = gzipSync(serializedRecords);
  await fs.writeFile(recordsPath, gzRecords);

  const manifest = {
    builtAt: new Date().toISOString(),
    counts: {
      docs: docs.length,
      tasks: tasks.length,
      total: docs.length + tasks.length,
    },
    sources: {
      docsPath: config.docs.localPath,
      tasksPath: config.tasks.localPath,
    },
  };

  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));

  console.error(
    `Built index (docs=${docs.length}, tasks=${tasks.length}) -> ${indexPath}, records -> ${recordsPath}, manifest -> ${manifestPath}`,
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exitCode = 1;
});
