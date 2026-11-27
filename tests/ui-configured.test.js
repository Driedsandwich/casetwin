import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { JSDOM } from 'jsdom';
import { createCloudPayload } from '../src/sharing.js';

const dom = new JSDOM('<!doctype html><div id="app"></div><div id="announcement"></div><dialog id="settings-dialog"></dialog><dialog id="bundle-dialog"></dialog>', { url: 'https://casetwin.test/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.CASETWIN_CONFIG = Object.fromEntries(['apiKey', 'authDomain', 'projectId', 'appId', 'appCheckSiteKey', 'cloudModel'].map(key => [key, 'test']));

const { action, state } = await import('../src/app.js');
const change = (selector, property, value) => {
  const input = document.querySelector(selector);
  input[property] = value;
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
};
const draftButton = () => document.querySelector('[data-action="draft"]');

test('Configured mode omits the demo notice in English and Japanese', async () => {
  for (const lang of ['en', 'ja']) {
    await action(lang);
    assert.equal(document.querySelector('.demo-banner'), null);
    assert.doesNotMatch(document.getElementById('app').textContent, /cloud steps are simulated|雲の処理は見本です/);
  }
  assert.match(document.querySelector('.guide').textContent, /試作の案内/);
});

test('Cloud draft regeneration requires fresh consent, preserves fictional row labels, and blocks the fourth draft', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'));
  const prompts = [];
  let finishFirstDraft;
  let firstDraftStarted;
  const started = new Promise(resolve => { firstDraftStarted = resolve; });
  const respond = (text, inferenceSource) => ({ response: { text: () => text, inferenceSource } });
  globalThis.testGenerateContent = async (prompt, mode) => {
    prompts.push({ prompt, mode });
    if (prompts.length === 1) {
      return new Promise(resolve => {
        finishFirstDraft = () => resolve(respond('English draft', 'in_cloud'));
        firstDraftStarted();
      });
    }
    if (mode === 'prefer_on_device') return respond('Short English draft', 'on_device');
    return respond(prompt.includes('in Japanese.') ? '日本語の下書き' : 'Regenerated English draft', 'in_cloud');
  };
  const asModule = source => `data:text/javascript,${encodeURIComponent(source)}`;
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    if (context.parentURL?.endsWith('/src/ai.js')) {
      if (specifier === './firebase.js') return { url: asModule('export const firebaseApp = async () => null;'), shortCircuit: true };
      if (specifier === 'firebase/ai') return { url: asModule(`
        export const InferenceMode = { ONLY_IN_CLOUD: 'only_in_cloud', PREFER_ON_DEVICE: 'prefer_on_device' };
        export class GoogleAIBackend {}
        export const getAI = () => null;
        export const getGenerativeModel = (_, options) => ({ generateContent: prompt => globalThis.testGenerateContent(prompt, options.mode) });
      `), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  } });

  try {
    await action('en');
    const bytes = new TextEncoder().encode('customer_id,name\nA,Private One\nB,Private Two\nC,Private Three\nB,Private Four\n');
    const { loadFile } = await import('../src/app.js');
    await loadFile({ name: 'private-file.csv', size: bytes.length, arrayBuffer: async () => bytes.buffer });
    change('#condition', 'value', 'duplicate');
    await action('generate');
    await action('review');
    assert.equal(state.report, null);
    assert.equal(draftButton().disabled, true);
    await action('draft');
    assert.equal(prompts.length, 0);

    change('#cloud-approval', 'checked', true);
    const pending = action('draft');
    await Promise.race([started, pending]);
    assert.ok(finishFirstDraft);
    await action('ja');
    finishFirstDraft();
    await pending;
    assert.equal(state.report.language, 'en');
    assert.equal(document.querySelector('.report-text').textContent, 'English draft');
    assert.match(document.querySelector('.report').textContent, /この下書きは英語で作られました/);
    assert.match(draftButton().textContent, /日本語で作り直す/);
    assert.equal(draftButton().disabled, true);
    await action('draft');
    assert.equal(prompts.length, 1);

    await action('rewrite');
    assert.match(prompts[1].prompt, /in plain English\./);
    assert.equal(state.report.language, 'en');
    change('#approval', 'checked', true);
    change('#cloud-approval', 'checked', true);
    await action('draft');
    assert.equal(state.report.language, 'ja');
    assert.equal(document.querySelector('.report-text').textContent, '日本語の下書き');
    assert.equal(document.querySelector('.report-text').lang, 'ja');
    assert.doesNotMatch(document.querySelector('.report').textContent, /この下書きは英語で作られました/);
    assert.equal(document.querySelector('#approval').checked, false);
    assert.equal(document.querySelector('#cloud-approval').checked, false);

    const matchLabel = () => document.querySelectorAll('.match-card strong')[1].textContent;
    const japaneseLabel = matchLabel();
    await action('en');
    assert.match(document.querySelector('.report').textContent, /This draft was generated in Japanese/);
    assert.match(draftButton().textContent, /Regenerate in English/);
    assert.equal(draftButton().disabled, true);
    change('#cloud-approval', 'checked', true);
    await action('draft');
    assert.equal(state.report.language, 'en');

    const preview = JSON.parse(document.querySelector('.payload-preview pre').textContent);
    assert.equal(matchLabel(), 'Row 3');
    assert.equal(japaneseLabel, '行 3');
    assert.equal(preview.syntheticRows.failureRow, 'Row 3');
    assert.deepEqual(preview.syntheticRows.relatedRows, ['Row 2', 'Row 3']);
    const drafts = prompts.filter(entry => entry.mode === 'only_in_cloud');
    assert.equal(drafts.length, 3);
    for (const [index, { prompt }] of drafts.entries()) {
      assert.ok(prompt.startsWith(`Write a concise developer DRAFT in ${index === 1 ? 'Japanese' : 'English'}.`));
      assert.match(prompt, /Refer to rows only by the exact labels in syntheticRows/);
      assert.deepEqual(JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)), preview);
      assert.doesNotMatch(prompt, /private-file\.csv|Private (One|Two|Three|Four)|Row 4|Short English draft/);
    }
    assert.deepEqual(preview, createCloudPayload(state.synthetic));
    const thirdDraft = state.report;
    for (const [language, message] of [
      ['en', 'In this demo, a cloud draft can be generated up to 3 times per tab.'],
      ['ja', 'このデモで雲の下書きを作れるのは 1 つのタブで 3 回までです。']
    ]) {
      await action(language);
      change('#cloud-approval', 'checked', true);
      await action('draft');
      assert.equal(prompts.length, 4); // Three cloud drafts and one rewrite.
      assert.equal(document.querySelector('.toast').textContent, message);
      assert.equal(document.getElementById('announcement').textContent, message);
      assert.equal(state.report, thirdDraft);
    }
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    hooks.deregister();
    delete globalThis.testGenerateContent;
  }
});
