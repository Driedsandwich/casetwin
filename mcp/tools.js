import { demoBundle, validateShareBundle } from '../src/sharing.js';
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
export async function loadApprovedBundle({ demo = true, bundlePath } = {}) {
  if (demo) return demoBundle();
  if (!bundlePath || (await stat(bundlePath)).size > 100000) throw new Error('APPROVED_BUNDLE_REQUIRED');
  return validateShareBundle(JSON.parse(await readFile(bundlePath, 'utf8')));
}
export async function callTool(name, options = {}) {
  // No user-supplied path or CSV is accepted in MCP tool arguments.
  const bundle = await loadApprovedBundle(options);
  if (name === 'prepare_repro') return { status: 'prepared', bundlePath: options.demo !== false ? 'demo://approved-repro' : resolve(options.bundlePath), approved: true };
  if (name === 'get_repro') return { filename: 'repro-synthetic.csv', ...bundle.synthetic, approved: true };
  if (name === 'get_validation_report') return { fingerprint: bundle.fingerprint, validation: bundle.validation };
  throw new Error('UNKNOWN_TOOL');
}
