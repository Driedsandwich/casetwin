import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div><div id="announcement"></div><dialog id="settings-dialog"></dialog><dialog id="bundle-dialog"></dialog></body></html>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
const { action, render, state, matched, loadFile } = await import('../src/app.js');
const change = (id, value, checked) => {
  const input = document.getElementById(id);
  if (value !== undefined) input.value = value;
  if (checked !== undefined) input.checked = checked;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};

test('English is default and Demo mode is visible with no Japanese guide', () => {
  assert.equal(document.documentElement.lang, 'en');
  assert.ok(document.body.textContent.includes('Demo mode — cloud steps are simulated'));
  assert.equal(document.querySelector('.guide'), null);
  assert.equal(state.source.rows.length, 64);
  assert.ok(document.querySelector('[data-action="review"]').disabled);
});
test('Manual workflow creates a real match and presents disclosure before local export', async () => {
  await action('manual'); change('condition', 'duplicate'); await action('generate');
  assert.equal(matched(), true);
  assert.equal(document.querySelector('.result').tagName, 'DIV');
  assert.ok(document.querySelector('.result').textContent.includes('Same failure reproduced'));
  await action('review');
  assert.equal(state.view, 'review');
  assert.equal(document.querySelectorAll('.transfer section').length, 2);
  assert.ok(document.querySelector('[data-action="export"]').disabled);
  assert.ok(document.querySelector('.payload-preview').textContent.includes('importerCode'));
  change('approval', undefined, true);
  assert.equal(document.querySelector('[data-action="export"]').disabled, false);
  await action('preview');
  const json = document.getElementById('bundle-json').value;
  assert.ok(!json.includes('fictional-demo.csv'));
  assert.ok(!json.includes('DEMO-FICTION'));
  await action('close-bundle');
  let download;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = blob => { download = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  dom.window.HTMLAnchorElement.prototype.click = function () { assert.equal(this.download, 'casetwin-share-bundle.json'); };
  try { await action('export'); assert.equal(JSON.parse(await download.text()).approved, true); }
  finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
  assert.equal(state.notice, 'exported');
});
test('Condition changes revoke approval and mismatches block review', async () => {
  await action('back');
  change('condition', 'newline');
  assert.equal(state.synthetic, null); assert.equal(state.approved, false);
  await action('generate'); assert.equal(matched(), false);
  assert.ok(document.querySelector('[data-action="review"]').disabled);
  await action('review'); assert.equal(state.view, 'main');
});
test('Missing local AI returns to manual selection with no fabricated source', async () => {
  await action('sample'); await action('analyze');
  assert.equal(state.aiStatus, 'manual');
  assert.equal(state.aiReason, 'unavailable');
  assert.equal(state.inferenceSource, null);
  assert.match(document.querySelector('.candidates [role="status"]').textContent, /On-device AI is unavailable\. Choose a condition below\./);
  assert.ok(document.getElementById('condition'));
});
test('Locale switch preserves data and only Japanese gets prototype guidance', async () => {
  const source = state.source;
  await action('ja'); assert.equal(document.documentElement.lang, 'ja'); assert.ok(document.querySelector('.guide'));
  assert.match(document.querySelector('.demo-banner').textContent, /雲の処理は見本です/);
  assert.match(document.querySelector('.candidates [role="status"]').textContent, /端末の AI を利用できません。\s*下から条件を選んでください。/);
  assert.equal(state.source, source);
  for (const heading of document.querySelectorAll('h1,h2,h3,title')) assert.doesNotMatch(heading.textContent, /[,、]/);
  await action('en'); assert.equal(document.querySelector('.guide'), null);
  for (const heading of document.querySelectorAll('h1,h2,h3,title')) assert.doesNotMatch(heading.textContent, /[,、]/);
});
test('Private filenames and cell contents are escaped and oversized input is refused', async () => {
  const bytes = new TextEncoder().encode('customer_id,name\nID,<script>private</script>\nID,<img src=x>\n');
  await loadFile({ name: '<img src=x>.csv', size: bytes.length, arrayBuffer: async () => bytes.buffer });
  assert.equal(document.querySelectorAll('#app img,#app script').length, 0);
  assert.ok(document.body.textContent.includes('<img src=x>.csv'));
  await loadFile({ name: 'large.csv', size: 2 * 1024 * 1024 + 1 });
  assert.equal(state.notice, 'tooLarge'); assert.equal(state.source, null);
});
test('Settings exposes the agent boundary and functional Demo auth', async () => {
  await action('settings');
  const dialog = document.getElementById('settings-dialog');
  assert.ok(dialog.open); assert.ok(dialog.textContent.includes('For AI agents'));
  assert.ok(dialog.textContent.includes('prepare_repro'));
  await action('sign-in'); assert.equal(state.signedIn, true); assert.equal(state.notice, 'demoSignIn');
  await action('sign-out'); assert.equal(state.signedIn, false);
  await action('close-settings'); assert.equal(dialog.open, false);
});
test('Demo rewrite and save remain explicit simulations and rewrite revokes approval', async () => {
  await action('sample'); change('condition', 'duplicate'); await action('generate'); await action('review');
  change('approval', undefined, true); await action('rewrite');
  assert.equal(state.approved, false); assert.equal(state.report.simulated, true); assert.equal(state.report.inferenceSource, null);
  change('approval', undefined, true); await action('save');
  assert.equal(state.notice, 'demoSaved');
  render();
});
test('Demo draft regeneration follows the selected language without cloud consent', async () => {
  await action('en');
  await action('sample'); change('condition', 'duplicate'); await action('generate'); await action('review');
  assert.equal(state.report.language, 'en');
  await action('ja');
  assert.match(document.querySelector('.report').textContent, /この下書きは英語で作られました/);
  assert.equal(document.querySelector('#cloud-approval'), null);
  assert.equal(document.querySelector('[data-action="draft"]').disabled, false);
  await action('draft');
  assert.equal(state.report.language, 'ja');
  assert.equal(state.report.simulated, true);
  assert.equal(document.querySelector('.report-text').lang, 'ja');
  assert.equal(document.querySelector('[data-action="draft"]'), null);
});
