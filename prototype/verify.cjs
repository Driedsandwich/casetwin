'use strict';
// No dependencies, browser, network, or generated output files.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { TextEncoder, TextDecoder } = require('node:util');
const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
function script(id) {
  const match = html.match(new RegExp('<script id="' + id + '">([\\s\\S]*?)<\\/script>'));
  assert.ok(match, 'Missing inline script: ' + id);
  return match[1];
}
const context = vm.createContext({ TextEncoder, TextDecoder, Uint8Array });
vm.runInContext(script('case-twin-core'), context);
const C = vm.runInContext('CaseTwinCore', context);
const normalize = value => JSON.parse(JSON.stringify(value));
let count = 0;
function test(name, fn) { fn(); count++; console.log('✓ ' + name); }
function noOriginalCells(source, generated) {
  const values = new Set(source.rows.flat());
  for (const value of generated.data.rows.flat()) assert.equal(values.has(value), false, 'Original cell copied: ' + value);
}
const sample = C.makeSample();
const original = C.validate(sample);
const synthetic = C.generateSynthetic(sample, 'duplicate');
const repro = C.validate(synthetic.data);
test('Sample: 64 fictional rows, exactly one duplicate pair at data rows 42 / 43', () => {
  assert.equal(sample.rows.length, 64);
  assert.equal(new Set(sample.rows.map(row => row[0])).size, 63);
  assert.ok(sample.rows.every(([id, name]) => id.startsWith('DEMO-FICTION-') && name.startsWith('Fictional customer ')));
  assert.deepEqual(normalize(original.relatedRows), [42, 43]);
  assert.deepEqual(normalize(original.fingerprint), { kind: 'DUPLICATE_KEY', field: 'customer_id', condition: 'repeated_key' });
});
test('Real generator: three fictional rows; same fingerprint; different data row', () => {
  assert.equal(synthetic.data.rows.length, 3);
  assert.equal(repro.row, 3);
  assert.equal(original.row, 43);
  assert.equal(C.fingerprintsMatch(original, repro), true);
  assert.equal(new Set(synthetic.data.rows.map(row => row[0])).size, 2);
});
test('No original data-cell value remains in the generated CSV (schema names are shared)', () => {
  noOriginalCells(sample, synthetic);
  for (const value of sample.rows.flat()) assert.equal(synthetic.csv.includes(value), false);
});
test('Deterministic generation for identical input and condition', () => {
  assert.equal(C.generateSynthetic(sample, 'duplicate').csv, synthetic.csv);
  assert.deepEqual([...C.generateSynthetic(sample, 'duplicate').bytes], [...synthetic.bytes]);
});
test('Collision avoidance: uploaded source already contains default synthetic values', () => {
  const source = C.readText(C.encodeCSV(['customer_id', 'name'], [['SYN-FICTION-001', 'Fictional synthetic A'], ['SYN-FICTION-002', 'Fictional synthetic B'], ['SYN-FICTION-002', 'Fictional synthetic C']]));
  const generated = C.generateSynthetic(source, 'duplicate');
  noOriginalCells(source, generated);
  assert.equal(C.fingerprintsMatch(C.validate(source), C.validate(generated.data)), true);
});
test('Changing error kind, field, condition or validator version breaks the match', () => {
  for (const key of ['kind', 'field', 'condition']) {
    const changed = normalize(repro); changed.fingerprint[key] = 'different';
    assert.equal(C.fingerprintsMatch(original, changed), false);
  }
  assert.equal(C.fingerprintsMatch(original, { ...repro, version: 'r18' }), false);
  assert.equal(C.fingerprintsMatch(original, null), false);
});
test('Two passing files are never called a reproduced failure', () => {
  const clean = C.readText('customer_id,name\r\nCLEAN-1,Fictional One\r\nCLEAN-2,Fictional Two\r\n');
  const report = C.validate(clean);
  assert.equal(report.ok, true);
  assert.equal(report.fingerprint, null);
  assert.equal(C.fingerprintsMatch(report, report), false);
  assert.equal(C.fingerprintsMatch(report, repro), false);
});
test('Mandatory column validation and reproduction for both required columns', () => {
  for (const missing of ['customer_id', 'name']) {
    const header = missing === 'name' ? 'customer_id' : 'name';
    const source = C.readText(header + '\r\nFictional A\r\nFictional B\r\n');
    const report = C.validate(source);
    const generated = C.generateSynthetic(source, 'missing');
    assert.equal(report.fingerprint.kind, 'MISSING_COLUMN');
    assert.equal(report.fingerprint.field, missing);
    assert.equal(C.fingerprintsMatch(report, C.validate(generated.data)), true);
    noOriginalCells(source, generated);
  }
});
test('Quoted embedded newline is parsed, rejected by validator and reproduced', () => {
  const source = C.readText('customer_id,name\r\nFICTION-1,"Fictional\r\nPerson"\r\n');
  assert.equal(source.rows.length, 1);
  assert.equal(source.rows[0][1], 'Fictional\r\nPerson');
  const report = C.validate(source);
  assert.equal(report.fingerprint.kind, 'EMBEDDED_NEWLINE');
  assert.equal(report.fingerprint.field, 'name');
  assert.equal(report.row, 1);
  assert.equal(report.checks.duplicate, 'not_run');
  const generated = C.generateSynthetic(source, 'newline');
  assert.equal(C.fingerprintsMatch(report, C.validate(generated.data)), true);
  noOriginalCells(source, generated);
});
test('Newline in customer_id keeps the same field in the reproduction', () => {
  const source = C.readText('customer_id,name\n"FICTION\n001",Fictional Person\n');
  const generated = C.generateSynthetic(source, 'newline');
  assert.equal(C.fingerprintsMatch(C.validate(source), C.validate(generated.data)), true);
});
test('Additional source-column newline cannot masquerade as a matching known-column failure', () => {
  const source = C.readText('customer_id,name,notes\nFICTION-1,Fictional,"Fictional\nNote"\n');
  assert.equal(C.fingerprintsMatch(C.validate(source), C.validate(C.generateSynthetic(source, 'newline').data)), false);
});
test('UTF-8: invalid bytes fail before CSV validation and survive synthetic reproduction', () => {
  const bytes = new Uint8Array([...new TextEncoder().encode('customer_id,name\nFICTION-1,'), 255, 10]);
  const source = C.readBytes(bytes), report = C.validate(source);
  assert.equal(report.fingerprint.kind, 'INVALID_ENCODING');
  assert.equal(report.checks.required, 'not_run');
  const generated = C.generateSynthetic(source, 'encoding');
  assert.equal(generated.data.encodingValid, false);
  assert.equal(C.fingerprintsMatch(report, C.validate(generated.data)), true);
  noOriginalCells(source, generated);
  const bundle = C.buildBundle(report, generated, true, 'Fictional draft');
  assert.deepEqual([...Buffer.from(bundle.files['repro-synthetic.csv'].content, 'base64')], [...generated.bytes]);
});
test('Valid Japanese UTF-8, BOM, commas and escaped quotes are handled correctly', () => {
  const source = C.readText('\uFEFFcustomer_id,name\r\n架空-1,"架空,人物"\r\n架空-2,"架空の""人物"""\r\n');
  assert.equal(C.validate(source).ok, true);
  assert.equal(source.rows[1][1], '架空の"人物"');
  const roundtrip = C.readText(C.encodeCSV(source.headers, source.rows));
  assert.deepEqual(normalize(roundtrip.rows), normalize(source.rows));
});
test('Normal CRLF record delimiters are not embedded newlines', () => {
  const result = C.validate(C.readText('customer_id,name\r\nFICTION-1,Fictional One\r\nFICTION-2,Fictional Two\r\n'));
  assert.equal(result.ok, true);
  assert.ok(Object.values(result.checks).every(value => value === 'pass'));
});
test('CSV syntax failures are explicit and malformed files do not crash the validator', () => {
  for (const csv of ['customer_id,name\nF-1,"unclosed', 'customer_id,name\nF-1,"closed"junk', 'customer_id,name\nF-1,too,many', 'customer_id,customer_id\nF-1,F-2', 'customer_id,name\nF-1,bad"quote']) {
    assert.equal(C.validate(C.readText(csv)).fingerprint.kind, 'CSV_FORMAT');
  }
  assert.equal(C.validate(C.readText('')).fingerprint.kind, 'MISSING_COLUMN');
});
test('10,000 data-row limit gives a clear fingerprint', () => {
  const csv = 'customer_id,name\n' + Array.from({ length: 10001 }, (_, i) => `FICTION-${i},Fictional ${i}`).join('\n');
  assert.equal(C.validate(C.readText(csv)).fingerprint.condition, 'row_limit');
});
test('Wrong candidate cannot reach an approved bundle', () => {
  const wrong = C.generateSynthetic(sample, 'newline');
  assert.equal(C.fingerprintsMatch(original, C.validate(wrong.data)), false);
  assert.throws(() => C.buildBundle(original, wrong, true, 'Draft'), /HANDOFF_NOT_APPROVED/);
  assert.throws(() => C.buildBundle(original, synthetic, false, 'Draft'), /HANDOFF_NOT_APPROVED/);
  assert.throws(() => C.generateSynthetic(sample, 'unknown'), /UNKNOWN_CONDITION/);
});
test('Bundle allowlist: original cells, row numbers and filenames are excluded', () => {
  const bundle = C.buildBundle(original, synthetic, true, 'Fictional draft');
  assert.deepEqual(Object.keys(bundle.files), ['repro-synthetic.csv', 'importer-r17.cjs', 'validation.json', 'report-draft.txt']);
  assert.equal(bundle.sent, false);
  const serialized = JSON.stringify(bundle);
  for (const value of sample.rows.flat()) assert.equal(serialized.includes(value), false);
  const report = JSON.parse(bundle.files['validation.json'].content);
  for (const result of [report.original, report.synthetic]) {
    assert.equal('row' in result, false);
    assert.equal('relatedRows' in result, false);
    assert.equal('filename' in result, false);
    assert.deepEqual(Object.keys(result), ['ok', 'version', 'fingerprint', 'checks']);
  }
});
test('Exported importer is executable code and produces the identical validation result', () => {
  const importerContext = vm.createContext({ TextEncoder, TextDecoder, Uint8Array, module: { exports: {} } });
  vm.runInContext(C.importerCode(), importerContext);
  const importer = importerContext.module.exports;
  for (const bytes of [new TextEncoder().encode(sample.text), synthetic.bytes, C.generateSynthetic(sample, 'encoding').bytes]) {
    assert.deepEqual(normalize(importer.validate(importer.readBytes(bytes))), normalize(C.validate(C.readBytes(bytes))));
  }
});
test('Single HTML: inline scripts parse; no external assets or network API calls', () => {
  new vm.Script(script('case-twin-core'));
  new vm.Script(script('case-twin-ui'));
  assert.equal(/<script[^>]+src\s*=|<link[^>]+href\s*=|@import|url\(\s*["']?https?:/i.test(html), false);
  assert.equal(/\b(fetch|XMLHttpRequest|WebSocket|sendBeacon)\s*\(/.test(html), false);
  assert.ok(html.includes("connect-src 'none'"));
  assert.equal(/\b(localStorage|sessionStorage|indexedDB)\b/.test(script('case-twin-ui')), false);
});
// Lightweight state/render harness. This is NOT a browser, DOM parser, layout or screenshot test.
const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, { innerHTML: '', textContent: '', open: false, showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, setAttribute() {} });
  return elements.get(id);
}
const listeners = {};
const ui = vm.createContext({ TextEncoder, TextDecoder, Uint8Array,
  document: { documentElement: { lang: '' }, title: '', getElementById: element, querySelector: () => element('focus'), addEventListener: (type, fn) => { listeners[type] = fn; } },
  window: { scrollTo() {} }
});
vm.runInContext(script('case-twin-core') + '\n' + script('case-twin-ui'), ui);
const run = code => vm.runInContext(code, ui);
test('UI state: Japanese is default, the guide is present, and EN preserves workflow', () => {
  assert.equal(run('state.lang'), 'ja');
  assert.ok(element('app').innerHTML.includes('これは試作です。'));
  run("action('en')");
  assert.equal(run('state.lang'), 'en');
  assert.equal(element('app').innerHTML.includes('これは試作です。'), false);
  assert.ok(element('app').innerHTML.includes('Load sample CSV'));
  run("action('ja')");
});
test('UI state: sample → mock candidates → matching repro → review → explicit approval → preview only', () => {
  run("action('sample'); action('generate')");
  assert.equal(run('state.synthetic'), null);
  run("action('candidates'); action('generate')");
  assert.equal(run('matched()'), true);
  run("action('review'); action('bundle')");
  assert.equal(element('bundle-dialog').open, false);
  listeners.change({ target: { id: 'approval', checked: true } });
  run("action('bundle')");
  assert.equal(element('bundle-dialog').open, true);
  const output = element('bundle-dialog').innerHTML;
  assert.ok(output.includes('repro-synthetic.csv'));
  assert.equal(output.includes('DEMO-FICTION'), false);
  assert.equal(output.includes('fictional-demo.csv'), false);
  assert.ok(output.includes('表示のみ'));
  run("action('close-bundle'); action('back')");
  assert.equal(run('state.approved'), false);
});
test('UI state: candidate change invalidates result and mismatch blocks review', () => {
  listeners.change({ target: { id: 'condition', value: 'newline' } });
  assert.equal(run('state.synthetic'), null);
  assert.equal(run('state.approved'), false);
  run("action('generate'); action('review')");
  assert.equal(run('matched()'), false);
  assert.equal(run('state.view'), 'main');
  assert.ok(element('app').innerHTML.includes('再現できていない'));
});
test('UI state: without local AI, no candidates appear; manual choice can reproduce', () => {
  run("action('ai-no'); action('candidates')");
  assert.equal(run('state.ai'), false);
  assert.equal(run('state.candidates'), false);
  assert.equal(run('state.condition'), '');
  assert.ok(element('app').innerHTML.includes('担当者が条件を選ぶ'));
  assert.equal(element('app').innerHTML.includes('見本の推奨候補'), false);
  listeners.change({ target: { id: 'condition', value: 'duplicate' } });
  run("action('generate'); action('review')");
  assert.equal(run('matched()'), true);
  assert.equal(run('state.view'), 'review');
  run("action('ai-yes')");
  assert.equal(run('state.view'), 'main');
  assert.equal(run('state.synthetic'), null);
});
test('UI state: settings list planned tools and do not expose callable endpoints', () => {
  run("action('settings')");
  for (const name of ['prepare_repro', 'get_repro', 'get_validation_report']) {
    assert.ok(element('settings-dialog').innerHTML.includes(name));
    assert.equal(run(`typeof ${name}`), 'undefined');
  }
  assert.ok(element('settings-dialog').innerHTML.includes('呼び出し口を実装していません'));
  run("action('close-settings')");
});
test('Uploaded names and cells are escaped in the rendered HTML', () => {
  run(`state.source = C.readText('customer_id,name\\nFICTION-1,<img src=x onerror=alert(1)>\\nFICTION-1,<script>unsafe<\\/script>\\n'); state.original = C.validate(state.source); state.filename = '<img src=x onerror=alert(1)>.csv'; render();`);
  assert.equal(element('app').innerHTML.includes('<img src=x'), false);
  assert.ok(element('app').innerHTML.includes('&lt;img'));
});
(async () => {
  // Exercise the real async file input handler with memory-backed fake Files.
  await listeners.change({ target: { id: 'csv-file', files: [{ name: 'fictional-upload.csv', size: Buffer.byteLength(sample.text), arrayBuffer: async () => new TextEncoder().encode(sample.text).buffer }] } });
  test('File handler: local byte reading validates input and clears stale results', () => {
    assert.equal(run('state.original.fingerprint.kind'), 'DUPLICATE_KEY');
    assert.equal(run('state.filename'), 'fictional-upload.csv');
    assert.equal(run('state.synthetic'), null);
    assert.equal(run('state.busy'), false);
  });
  await listeners.change({ target: { id: 'csv-file', files: [{ name: 'too-large.csv', size: 2 * 1024 * 1024 + 1 }] } });
  test('File handler: oversized input clears old state and gives an error', () => {
    assert.equal(run('state.source'), null);
    assert.equal(run('state.notice'), 'tooLarge');
    assert.equal(run('state.busy'), false);
  });
  await listeners.change({ target: { id: 'csv-file', files: [{ name: 'unreadable.csv', size: 10, arrayBuffer: async () => { throw new Error('unreadable'); } }] } });
  test('File handler: read errors are explicit and leave no previous handoff', () => {
    assert.equal(run('state.notice'), 'readError');
    assert.equal(run('state.source'), null);
    assert.equal(run('state.approved'), false);
  });
  let release;
  const pending = listeners.change({ target: { id: 'csv-file', files: [{ name: 'stale.csv', size: 1, arrayBuffer: () => new Promise(resolve => { release = resolve; }) }] } });
  run("action('sample')");
  release(new TextEncoder().encode('customer_id,name\nSTALE,Fictional\n').buffer);
  await pending;
  test('File handler: a stale asynchronous read cannot overwrite a newer sample', () => {
    assert.equal(run('state.filename'), 'fictional-demo.csv');
    assert.equal(run('state.source.rows.length'), 64);
  });
  console.log(`\n${count} checks passed. Browser layout, keyboard behavior and actual Chrome file opening remain unverified.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
