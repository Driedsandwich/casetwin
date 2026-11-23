#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { callTool } from './tools.js';
const demo = process.argv.includes('--demo');
const bundlePath = process.env.CASETWIN_BUNDLE_PATH;
const options = { demo, bundlePath };
const server = new McpServer({ name: 'casetwin', version: '1.0.0' });
const descriptions = {
  prepare_repro: 'Request reproduction preparation. Returns only the location of an already exported human-approved local bundle. Does not generate, infer, approve or send. Export from CaseTwin first. Demo mode uses an approved fictional fixture.',
  get_repro: 'Read only the approved fictional synthetic CSV. Never returns customer CSV, original filename, original values or original row numbers.',
  get_validation_report: 'Read only the matched fingerprint and sanitized validation checks. No original rows, values or metadata.'
};
for (const [name, description] of Object.entries(descriptions)) {
  server.registerTool(name, { description, inputSchema: {}, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } }, async () => {
    try { return { content: [{ type: 'text', text: JSON.stringify(await callTool(name, options)) }] }; }
    catch { return { isError: true, content: [{ type: 'text', text: 'No valid approved bundle is available. Export and review a synthetic bundle in CaseTwin first.' }] }; }
  });
}
await server.connect(new StdioServerTransport());
