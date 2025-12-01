import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { RepoConfig } from '../config.js';

const execFileAsync = promisify(execFile);

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function ensureRepoCloned(config: RepoConfig): Promise<void> {
  const hasGitDir = await pathExists(path.join(config.localPath, '.git'));
  if (hasGitDir) {
    return;
  }

  if (!config.url) {
    // No git repo and no URL provided: assume caller is pointing at a static/local path and skip cloning.
    return;
  }

  await fs.mkdir(config.localPath, { recursive: true });
  await execFileAsync('git', ['clone', '--branch', config.branch, config.url, config.localPath]);
}

export async function syncRepo(config: RepoConfig): Promise<void> {
  if (!config.url) {
    // No remote; assume local path is already present and skip sync.
    return;
  }

  await ensureRepoCloned(config);

  await execFileAsync('git', ['fetch', '--prune'], { cwd: config.localPath });
  await execFileAsync('git', ['checkout', config.branch], { cwd: config.localPath });
  await execFileAsync('git', ['reset', '--hard', `origin/${config.branch}`], { cwd: config.localPath });
}
