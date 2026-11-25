import { strict as assert } from 'node:assert';
import { docDetailSchema, searchResponseSchema } from '../schemas.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

async function main() {
  const client = new Client({ name: 'doc-resource-smoke', version: '1' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/index.js'] }));
  try {
    const result = await client.callTool({ name: 'search_docs', arguments: { query: 'Functions' } });
    assert(!result.isError);
    const hits = searchResponseSchema.parse(result.structuredContent).items;
    assert(hits.length > 0);
    for (const hit of hits) {
      assert(hit.url);
      const url = new URL(hit.url);
      assert.equal(url.origin, 'https://learn.mechanic.dev');
      assert(!url.pathname.includes('://') && !url.pathname.endsWith('.md'));
      assert.equal(hit.sourceUrl, hit.url);
    }
    const guide = await client.callTool({ name: 'get_doc', arguments: { id: 'doc:core/functions.md' } });
    const detail = docDetailSchema.parse(guide.structuredContent);
    assert.equal(detail.url, 'https://learn.mechanic.dev/core/functions');
    assert.match(detail.content, /Functions are included in your Mechanic subscription/);
    console.log('Verified live-format documentation links and the bundled Functions guide.');
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
