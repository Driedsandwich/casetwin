import test from 'node:test';
import assert from 'node:assert/strict';
import { FEATURES, assertPolicy, candidateOutcome, localSummary, serialQueue } from '../src/inference-policy.js';
import { modelOptions, requireLocalCapability } from '../src/ai.js';
import { configuration, DEMO_CONFIG } from '../src/config.js';
import { dictionaries } from '../src/i18n.js';
import C from '../src/core.js';
import * as browserSDK from '../node_modules/@firebase/ai/dist/esm/index.esm.js';
const { InferenceMode, GenerativeModel } = browserSDK;
const copiedPolicy = () => JSON.parse(JSON.stringify(FEATURES));
const expectedCreateOptions = {
  expectedInputs: [{ type: 'text', languages: ['en', 'ja'] }],
  expectedOutputs: [{ type: 'text', languages: ['en', 'ja'] }]
};
const deviceEnvironment = (availability = async () => 'available') => ({ window: { LanguageModel: { availability } } });

test('Every feature has its required inference mode', () => {
  assert.equal(assertPolicy(), true);
  assert.deepEqual(Object.values(FEATURES).map(rule => rule.mode), ['ONLY_ON_DEVICE', 'ONLY_IN_CLOUD', 'PREFER_ON_DEVICE']);
});
test('Original CSV values filename rows and summary cannot use a cloud-capable mode', () => {
  for (const input of ['originalCSV', 'originalSummary', 'originalRows', 'originalValues', 'originalFilename', 'originalRowNumbers']) {
    for (const mode of ['ONLY_IN_CLOUD', 'PREFER_ON_DEVICE']) {
      const policy = copiedPolicy(); policy.draft.inputs.push(input); policy.draft.mode = mode;
      assert.throws(() => assertPolicy(policy), /PRIVATE_INPUT_MODE/);
    }
  }
});
test('Policy rejects private flags unknown inputs and incorrect feature modes', () => {
  const policy = copiedPolicy(); policy.rewrite.private = true; assert.throws(() => assertPolicy(policy));
  const unknown = copiedPolicy(); unknown.draft.inputs.push('anything'); assert.throws(() => assertPolicy(unknown));
  const changed = copiedPolicy(); changed.draft.mode = 'PREFER_ON_DEVICE'; assert.throws(() => assertPolicy(changed));
});
test('SDK options are constructed from policy and use installed Firebase enum', () => {
  for (const feature of Object.keys(FEATURES)) {
    assert.equal(modelOptions(feature, { InferenceMode }, 'test').mode, InferenceMode[FEATURES[feature].mode]);
  }
  const candidates = modelOptions('candidates', { InferenceMode }, 'test');
  assert.equal(candidates.inCloudParams, undefined);
  assert.deepEqual(candidates.onDeviceParams.createOptions, expectedCreateOptions);
  assert.deepEqual(modelOptions('rewrite', { InferenceMode }, 'test').onDeviceParams, { createOptions: expectedCreateOptions });
  assert.equal(modelOptions('draft', { InferenceMode }, 'test').onDeviceParams, undefined);
  assert.equal(typeof GenerativeModel.prototype.initializeDeviceModel, 'function');
});
test('Missing LanguageModel is blocked before calling the SDK', () => {
  assert.throws(() => requireLocalCapability({}), /unavailable/);
  assert.throws(() => requireLocalCapability({ window: {}, LanguageModel: {} }), /unavailable/);
  const environment = deviceEnvironment();
  assert.equal(requireLocalCapability(environment), environment.window.LanguageModel);
});
test('Local summary contains schema types and failure shapes but no cell values or filename', () => {
  const source = C.makeSample(); source.filename = 'secret.csv';
  const summary = localSummary(source, C.validate(source));
  assert.ok(summary.columns.every(column => column.name && column.type));
  const text = JSON.stringify(summary);
  assert.ok(!text.includes('secret.csv'));
  assert.ok(!text.includes('DEMO-FICTION'));
  assert.ok(!text.includes('relatedRows'));
});
test('Absent failed or preparing local AI switches to manual without cloud retry', async () => {
  for (const cause of ['unavailable', 'preparing', 'failed']) {
    const calls = [];
    const result = await candidateOutcome(async feature => { calls.push(feature); throw new Error(cause); }, {});
    assert.equal(result.status, 'manual');
    assert.equal(result.reason, 'unavailable');
    assert.deepEqual(calls, ['candidates']);
    assert.equal(result.inferenceSource, null);
  }
});
test('Candidates use actual source and accept trailing blank lines', async () => {
  const result = await candidateOutcome(async () => ({ text: '{"candidates":[{"condition":"duplicate","confidence":"likely"}]}\n\n', inferenceSource: 'on_device' }), {});
  assert.equal(result.status, 'ready');
  assert.equal(result.inferenceSource, 'on_device');
  assert.equal(result.candidates[0].condition, 'duplicate');
});
test('Cloud or absent source and malformed local output cannot be shown as local suggestions', async () => {
  for (const response of [undefined, { text: '{"candidates":[]}', inferenceSource: 'on_device' }, { text: '{"candidates":[{"condition":"duplicate","confidence":"likely"}]}', inferenceSource: 'in_cloud' }, { text: 'not json', inferenceSource: 'on_device' }]) {
    assert.deepEqual(await candidateOutcome(async () => response, {}), { status: 'manual', reason: 'invalid-answer', candidates: [], inferenceSource: null });
  }
});
test('Candidates use the first JSON object and keep valid normalized entries after invalid ones', async () => {
  const candidates = [null, {}, { condition: 'unknown', confidence: 'likely' }, { condition: 'newline', confidence: 5 }, { condition: 'missing', confidence: 'certain' },
    { condition: ' Duplicate ', confidence: 'LIKELY', extra: 'escaped quote " and closing brace }' }, { condition: 'ENCODING', confidence: 'Possible' }];
  const text = `Here are the results {as requested}, with a stray { before the code:\n\`\`\`JSON\n${JSON.stringify({ candidates })}\n\`\`\`\n${JSON.stringify({ candidates: [{ condition: 'missing', confidence: 'likely' }] })}`;
  assert.deepEqual((await candidateOutcome(async () => ({ text, inferenceSource: 'on_device' }), {})).candidates, [
    { condition: 'duplicate', confidence: 'likely' }, { condition: 'encoding', confidence: 'possible' }
  ]);
});
test('A local deadline switches to manual and signals the pending request once', async () => {
  let signal;
  let calls = 0;
  const outcome = await candidateOutcome((_feature, _summary, requestSignal) => {
    calls++;
    signal = requestSignal;
    return new Promise(() => {});
  }, {}, 5);
  assert.deepEqual(outcome, { status: 'manual', reason: 'timeout', candidates: [], inferenceSource: null });
  assert.equal(calls, 1);
  assert.equal(signal.aborted, true);
});
test('Local calls serialize and a failed request does not poison the queue', async () => {
  const queue = serialQueue(); let active = 0, max = 0; const order = [];
  const job = i => queue(async () => { active++; max = Math.max(max, active); await Promise.resolve(); order.push(i); active--; if (i === 2) throw new Error('test'); return i; });
  const results = await Promise.allSettled([job(1), job(2), job(3)]);
  assert.equal(max, 1); assert.deepEqual(order, [1, 2, 3]); assert.equal(results[2].status, 'fulfilled');
});
test('Missing empty or partial Firebase settings select Demo mode', () => {
  for (const input of [undefined, {}, { apiKey: '' }, { apiKey: 'test' }]) assert.equal(configuration(input).demo, true);
  const complete = { apiKey: 'test', authDomain: 'test', projectId: 'test', appId: 'test', appCheckSiteKey: 'test', cloudModel: 'test' };
  assert.equal(configuration(complete).demo, false);
  assert.ok(Object.values(DEMO_CONFIG).every(value => value.length <= 11));
});
test('English and Japanese dictionary keys match', () => {
  assert.deepEqual(Object.keys(dictionaries.en).sort(), Object.keys(dictionaries.ja).sort());
  assert.ok(Object.values(dictionaries.en).every(value => typeof value === 'string' && value.length));
  assert.ok(Object.values(dictionaries.ja).every(value => typeof value === 'string' && value.length));
});

test('Inference runner initializes through Firebase and verifies the actual response source', async () => {
  const { createInferenceRunner } = await import('../src/ai.js');
  const calls = [];
  const run = createInferenceRunner({
    settings: { demo: false, cloudModel: 'test' }, environment: deviceEnvironment(async options => { calls.push(['availability', options]); return 'available'; }), getApp: async () => 'test',
    loadSDK: async () => ({ InferenceMode, GoogleAIBackend: class {}, getAI: app => { calls.push(['app', app]); return 'test'; }, getGenerativeModel: (ai, options) => {
      calls.push(['model', options]);
      return { chromeAdapter: { mode: options.mode }, initializeDeviceModel: async () => { calls.push(['initialize']); }, generateContent: async prompt => {
        calls.push(['prompt', prompt]);
        return { response: { text: () => 'answer\n\n', inferenceSource: options.mode === InferenceMode.ONLY_IN_CLOUD ? 'in_cloud' : 'on_device' } };
      } };
    } })
  });
  assert.equal((await run('candidates', 'test')).inferenceSource, 'on_device');
  assert.equal((await run('draft', 'test')).inferenceSource, 'in_cloud');
  assert.equal((await run('rewrite', 'test')).text, 'answer');
  assert.deepEqual(calls.filter(([key]) => key === 'model').map(([, value]) => value.mode), ['only_on_device', 'only_in_cloud', 'prefer_on_device']);
  assert.deepEqual(calls[0], ['availability', expectedCreateOptions]);
  assert.equal(calls[0][1], calls.find(([key]) => key === 'model')[1].onDeviceParams.createOptions);
  assert.equal(calls.filter(([key]) => key === 'initialize').length, 1);
});
test('Inference runner refuses missing device before loading SDK and rejects incorrect provenance', async () => {
  const { createInferenceRunner } = await import('../src/ai.js');
  let loaded = false;
  const blocked = createInferenceRunner({ environment: {}, loadSDK: async () => { loaded = true; } });
  await assert.rejects(blocked('candidates', 'private'), /unavailable/);
  assert.equal(loaded, false);
  for (const source of ['in_cloud', undefined]) {
    const run = createInferenceRunner({ settings: { demo: false, cloudModel: 'test' }, environment: deviceEnvironment(), getApp: async () => 'test', loadSDK: async () => ({ InferenceMode, GoogleAIBackend: class {}, getAI: () => 'test', getGenerativeModel: () => ({ chromeAdapter: { mode: InferenceMode.ONLY_ON_DEVICE }, initializeDeviceModel: async () => {}, generateContent: async () => ({ response: { text: () => 'answer', inferenceSource: source } }) }) }) });
    await assert.rejects(run('candidates', 'test'), /invalid-answer/);
  }
});
test('Candidates fail closed when Firebase constructs a model without a device adapter', async () => {
  const { createInferenceRunner } = await import('../src/ai.js');
  const calls = [];
  const run = createInferenceRunner({ environment: deviceEnvironment(), getApp: async () => 'test', loadSDK: async () => ({
    InferenceMode, GoogleAIBackend: class {}, getAI: () => 'test', getGenerativeModel: () => ({
      initializeDeviceModel: async () => { calls.push('initialize'); },
      generateContent: async () => { calls.push('generate'); }
    })
  }) });
  assert.deepEqual(await candidateOutcome((feature, _summary, signal) => run(feature, 'private', undefined, signal), {}), {
    status: 'manual', reason: 'unavailable', candidates: [], inferenceSource: null
  });
  assert.deepEqual(calls, []);
});
test('An unavailable device is blocked and SDK download failures preserve their reason', async () => {
  const { createInferenceRunner } = await import('../src/ai.js');
  for (const availability of ['unavailable', 'downloadable', 'downloading']) {
    const calls = [];
    const run = createInferenceRunner({ environment: deviceEnvironment(async () => availability), getApp: async () => 'test', loadSDK: async () => {
      calls.push('load');
      return { InferenceMode, GoogleAIBackend: class {}, getAI: () => 'test', getGenerativeModel: () => ({
        chromeAdapter: { mode: InferenceMode.ONLY_ON_DEVICE },
        initializeDeviceModel: async () => { calls.push('initialize'); throw new Error('private error details'); },
        generateContent: async () => { calls.push('generate'); }
      }) };
    } });
    const outcome = await candidateOutcome((feature, _summary, signal) => run(feature, 'private', undefined, signal), {});
    assert.deepEqual(outcome, { status: 'manual', reason: availability, candidates: [], inferenceSource: null });
    assert.deepEqual(calls, availability === 'unavailable' ? [] : ['load', 'initialize']);
  }
});
test('Installed browser SDK forwards the candidate schema to the on-device prompt', async t => {
  const fetch = t.mock.method(globalThis, 'fetch', () => assert.fail('Unexpected network request'));
  const { createInferenceRunner } = await import('../src/ai.js');
  const { initializeApp, deleteApp } = await import('firebase/app');
  const app = initializeApp({ apiKey: 'test', projectId: 'test', appId: 'test' }, 'local-schema-test');
  const calls = [];
  const environment = deviceEnvironment(async options => { calls.push(['availability', options]); return 'available'; });
  environment.window.LanguageModel.create = async options => {
    calls.push(['create', options]);
    return {
      prompt: async (messages, options) => {
        calls.push(['prompt', options]);
        assert.equal(messages[0].content[0].value, 'test');
        return '{"candidates":[{"condition":"duplicate","confidence":"likely"}]}';
      },
      destroy() {}
    };
  };
  globalThis.window = environment.window;
  try {
    const run = createInferenceRunner({ settings: { demo: false, cloudModel: 'test' }, environment, loadSDK: async () => browserSDK, getApp: async () => app });
    assert.equal((await run('candidates', 'test')).inferenceSource, 'on_device');
    assert.equal((await run('rewrite', 'test')).inferenceSource, 'on_device');
    const options = calls.filter(([name]) => name === 'prompt').map(([, options]) => options);
    const schema = options[0].responseConstraint;
    assert.deepEqual(schema.required, ['candidates']);
    assert.deepEqual(schema.properties.candidates.items.required, ['condition', 'confidence']);
    assert.deepEqual(schema.properties.candidates.items.properties.condition.enum, ['duplicate', 'newline', 'encoding', 'missing']);
    assert.deepEqual(schema.properties.candidates.items.properties.confidence.enum, ['likely', 'possible', 'unlikely']);
    assert.equal(options[1], undefined);
    for (const [name, options] of calls) {
      if (name !== 'prompt') assert.deepEqual(options, expectedCreateOptions);
    }
    assert.equal(fetch.mock.callCount(), 0);
  } finally {
    delete globalThis.window;
    await deleteApp(app);
  }
});
test('Demo runner never attempts real draft or rewrite inference', async () => {
  const { createInferenceRunner } = await import('../src/ai.js');
  let loaded = false;
  const run = createInferenceRunner({ settings: { demo: true }, loadSDK: async () => { loaded = true; } });
  await assert.rejects(run('draft', 'test'), /DEMO_CLOUD_DISABLED/);
  await assert.rejects(run('rewrite', 'test'), /DEMO_CLOUD_DISABLED/);
  assert.equal(loaded, false);
});
