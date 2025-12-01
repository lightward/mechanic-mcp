import fs from 'node:fs/promises';
import path from 'node:path';

export async function walkFiles(root: string, predicate: (file: string) => boolean): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const results: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);

    if (entry.isDirectory()) {
      const nested = await walkFiles(fullPath, predicate);
      results.push(...nested);
      continue;
    }

    if (entry.isFile() && predicate(fullPath)) {
      results.push(fullPath);
    }
  }

  return results;
}
