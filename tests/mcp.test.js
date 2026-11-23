import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { callTool } from '../mcp/tools.js';
import { demoBundle } from '../src/sharing.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('MCP demo tools expose only a fictional repro and sanitized validation', async () => {
  for (const name of ['prepare_repro', 'get_repro', 'get_validation_report']) {
    const result = await callTool(name, { demo: true });
    const text = JSON.stringify(result);
    for (const forbidden of ['DEMO-FICTION', 'Fictional customer', 'fictional-demo.csv', 'relatedRows', 'originalRowNumbers', 'report-draft']) assert.ok(!text.includes(forbidden));
    if (name === 'get_validation_report') assert.ok(!text.includes('"row"'));
  }
});
test('MCP reads an approved local bundle and returns only configured file location on preparation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casetwin-'));
  try {
    const path = join(directory, 'bundle.json');
    await writeFile(path, JSON.stringify(demoBundle()));
    const prepared = await callTool('prepare_repro', { demo: false, bundlePath: path });
    assert.deepEqual(prepared, { status: 'prepared', bundlePath: resolve(path), approved: true });
    const repro = await callTool('get_repro', { demo: false, bundlePath: path });
    assert.equal(repro.approved, true); assert.equal(repro.filename, 'repro-synthetic.csv');
  } finally { await rm(directory, { recursive: true }); }
});
test('MCP refuses unapproved bundles private fields and forged customer CSV', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'casetwin-'));
  try {
    for (const mutate of [b => b.approved = false, b => b.originalCSV = 'PRIVATE', b => b.validation.original.row = 43, b => b.synthetic.content = 'customer_id,name\nSECRET,Private Name\nSECRET,Other Name\n']) {
      const bundle = demoBundle(); mutate(bundle);
      const path = join(directory, 'bundle.json'); await writeFile(path, JSON.stringify(bundle));
      for (const name of ['prepare_repro', 'get_repro', 'get_validation_report']) await assert.rejects(callTool(name, { demo: false, bundlePath: path }));
    }
  } finally { await rm(directory, { recursive: true }); }
});
test('MCP production mode fails closed without an approved export', async () => {
  await assert.rejects(callTool('get_repro', { demo: false }));
});
test('MCP stdio handshake lists and runs all three tools without inference', async () => {
  const transport = new StdioClientTransport({ command: process.execPath, args: ['mcp/server.js', '--demo'], cwd: process.cwd(), stderr: 'pipe' });
  const client = new Client({ name: 'test', version: '1' });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.deepEqual(list.tools.map(tool => tool.name).sort(), ['get_repro', 'get_validation_report', 'prepare_repro']);
    for (const tool of list.tools) {
      const result = await client.callTool({ name: tool.name, arguments: {} });
      assert.ok(!result.isError);
      const payload = JSON.parse(result.content[0].text);
      assert.ok(payload);
      assert.ok(!JSON.stringify(payload).includes('DEMO-FICTION'));
    }
  } finally { await client.close(); }
});
