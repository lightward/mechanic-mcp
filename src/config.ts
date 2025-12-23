import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface RepoConfig {
  url?: string;
  branch: string;
  localPath: string;
}

export interface ApiConfig {
  baseUrl: string;
  token?: string;
  timeoutMs: number;
}

export interface ServerConfig {
  docs: RepoConfig;
  tasks: RepoConfig;
  syncIntervalMinutes: number;
  index: {
    maxDocs: number;
  };
  dataDir: string;
  api?: ApiConfig;
}

const env = process.env;

function resolvePath(value: string | undefined, fallback: string): string {
  if (value && path.isAbsolute(value)) {
    return value;
  }

  if (value) {
    return path.resolve(value);
  }

  return fallback;
}

export function loadConfig(): ServerConfig {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const projectRoot = path.resolve(moduleDir, '..');

  return {
    docs: {
      url: env.MECHANIC_DOCS_REPO_URL,
      branch: env.MECHANIC_DOCS_BRANCH || 'main',
      localPath: resolvePath(env.MECHANIC_DOCS_PATH, path.resolve(projectRoot, 'mechanic-docs')),
    },
    tasks: {
      url: env.MECHANIC_TASKS_REPO_URL,
      branch: env.MECHANIC_TASKS_BRANCH || 'main',
      localPath: resolvePath(env.MECHANIC_TASKS_PATH, path.resolve(projectRoot, 'mechanic-tasks')),
    },
    syncIntervalMinutes: Number(env.MECHANIC_SYNC_MINUTES || 30),
    index: {
      maxDocs: Number(env.MECHANIC_INDEX_MAX_DOCS || 20000),
    },
    dataDir: resolvePath(env.MECHANIC_DATA_PATH, path.resolve(projectRoot, 'dist', 'data')),
    api: {
      baseUrl: (env.MECHANIC_API_BASE || 'https://tools.mechanic.dev').replace(/\/$/, ''),
      token: env.MECHANIC_TOOL_TOKEN || env.MECHANIC_API_TOKEN,
      timeoutMs: Number(env.MECHANIC_API_TIMEOUT_MS || 8000),
    },
  };
}
