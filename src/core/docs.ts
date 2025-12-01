import fs from 'node:fs/promises';
import path from 'node:path';
import matter from 'gray-matter';
import { walkFiles } from './fs.js';
import type { DocRecord } from '../types.js';

const DOC_EXTENSIONS = new Set(['.md', '.mdx']);

function toTags(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(String);
  }

  if (typeof value === 'string') {
    return value.split(',').map((tag) => tag.trim()).filter(Boolean);
  }

  return [];
}

function firstHeading(content: string): string | undefined {
  const lines = content.split('\n');
  for (const line of lines) {
    const match = /^#{1,3}\s+(.*)$/.exec(line.trim());
    if (match) {
      return match[1].trim();
    }
  }
  return undefined;
}

function extractHeadings(content: string): string[] {
  return content
    .split('\n')
    .map((line) => /^#{1,3}\s+(.*)$/.exec(line.trim()))
    .filter((match): match is RegExpExecArray => Boolean(match))
    .map((match) => match[1].trim());
}

export async function loadDocs(root: string): Promise<DocRecord[]> {
  let files: string[] = [];
  try {
    files = await walkFiles(root, (file: string) => DOC_EXTENSIONS.has(path.extname(file)));
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      console.error(`Docs path not found (${root}); returning no docs.`);
      return [];
    }
    throw error;
  }

  const records = await Promise.all(
    files.map(async (filePath: string) => {
      const raw = await fs.readFile(filePath, 'utf8');
      const parsed = matter(raw);
      const relPath = path.relative(root, filePath);
      const heading = firstHeading(parsed.content);
      const title = (parsed.data.title as string | undefined) || heading || path.basename(filePath, path.extname(filePath));
      const urlPath = relPath.replace(/\\/g, '/');

      const record: DocRecord = {
        id: `doc:${relPath}`,
        kind: 'doc',
        title,
        path: `https://learn.mechanic.dev/${urlPath}`,
        section: relPath.split(path.sep)[0],
        tags: toTags(parsed.data.tags),
        headings: extractHeadings(parsed.content),
        content: parsed.content,
        sourceUrl: `https://learn.mechanic.dev/${urlPath}`,
      };

      return record;
    }),
  );

  return records;
}
