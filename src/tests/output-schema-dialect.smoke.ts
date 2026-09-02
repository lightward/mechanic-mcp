import { strict as assert } from 'node:assert';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const JSON_SCHEMA_2020_12 = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Regression test for the draft-07 outputSchema bug.
 *
 * The MCP SDK serialises tool schemas as draft-07 and never forwards a target
 * to its Zod-to-JSON-Schema converter, so schemas reach the client declaring an
 * unsupported dialect. Claude Desktop drops any such tool, which took out five
 * of the six tools here. src/mcp/server.ts corrects the dialect in tools/list;
 * this asserts it stays corrected.
 */
async function main() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ['dist/index.js'],
  });
  const client = new Client({ name: 'dialect-smoke', version: '1.0.0' }, { capabilities: {} });
  await client.connect(transport);

  try {
    const { tools } = await client.listTools();
    assert(tools.length > 0, 'Expected at least one tool');

    const withOutput = tools.filter((tool) => tool.outputSchema);
    assert(withOutput.length >= 5, `Expected >=5 tools with an outputSchema, got ${withOutput.length}`);

    for (const tool of tools) {
      for (const key of ['inputSchema', 'outputSchema'] as const) {
        const schema = tool[key] as { $schema?: string } | undefined;
        if (!schema) continue;
        assert.equal(
          schema.$schema,
          JSON_SCHEMA_2020_12,
          `${tool.name}.${key} must declare JSON Schema 2020-12, got ${schema.$schema}`,
        );
        assert(
          !('definitions' in schema),
          `${tool.name}.${key} must use $defs, not the draft-07 "definitions" keyword`,
        );
      }
    }

    console.log(`output schema dialect smoke passed (${tools.length} tools).`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
