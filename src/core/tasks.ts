import fs from 'node:fs/promises';
import path from 'node:path';
import type { TaskRecord } from '../types.js';

const TASKS_SUBDIR = 'tasks';

async function readTasks(root: string): Promise<TaskRecord[]> {
  const taskDir = path.join(root, TASKS_SUBDIR);
  let entries;
  try {
    entries = await fs.readdir(taskDir, { withFileTypes: true });
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      console.error(`Tasks path not found (${taskDir}); returning no tasks.`);
      return [];
    }
    throw error;
  }
  const tasks: TaskRecord[] = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) {
      continue;
    }

    if (entry.name.startsWith('.')) {
      continue;
    }

    const filePath = path.join(taskDir, entry.name);
    const raw = await fs.readFile(filePath, 'utf8');
    const json = JSON.parse(raw) as Record<string, unknown>;

    const handle = entry.name.replace(/\.json$/, '');
    const tags = Array.isArray(json.tags) ? (json.tags as unknown[]).map(String) : [];
    const subscriptions = Array.isArray(json.subscriptions) ? (json.subscriptions as unknown[]).map(String) : [];
    const options = (json as any).options as Record<string, unknown> | undefined;
    const script = (json as any).script as string | undefined;
    const onlineJs = (json as any).online_store_javascript as string | undefined | null;
    const orderJs = (json as any).order_status_javascript as string | undefined | null;
    const subsTemplate = (json as any).subscriptions_template as string | undefined;
    const pathPublic = `https://tasks.mechanic.dev/${handle}`;

    const record: TaskRecord = {
      id: `task:${handle}`,
      kind: 'task',
      slug: handle,
      title: (json.name as string) || handle,
      path: pathPublic,
      summary: (json.docs as string | undefined) || '',
      tags,
      events: subscriptions,
      actions: [],
      scopes: [],
      risk: 'unknown',
      options,
      script,
      online_store_javascript: onlineJs ?? null,
      order_status_javascript: orderJs ?? null,
      subscriptions_template: subsTemplate,
      content: [
        json.docs || '',
        json.subscriptions_template || '',
        json.script || '',
        json.online_store_javascript || '',
        json.order_status_javascript || '',
      ]
        .filter(Boolean)
        .join('\n\n'),
    };

    tasks.push(record);
  }

  return tasks;
}

export async function loadTasks(root: string): Promise<TaskRecord[]> {
  return readTasks(root);
}
