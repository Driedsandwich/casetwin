import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import C from '../src/core.js';
import { createCloudPayload, createShareBundle, validateShareBundle, syntheticFromFile, demoBundle, demoReport } from '../src/sharing.js';
const sample = C.makeSample();
const synthetic = C.generateSynthetic(sample, 'duplicate');
const original = C.validate(sample);
const copy = value => JSON.parse(JSON.stringify(value));

test('Production deterministic core is verbatim prototype JavaScript', async () => {
  const prototype = await readFile(new URL('../prototype/index.html', import.meta.url), 'utf8');
  const source = prototype.match(/<script id="case-twin-core">([\s\S]*?)<\/script>/)[1];
  const module = await readFile(new URL('../src/core.js', import.meta.url), 'utf8');
  assert.ok(module.includes(source));
});
test('64 fictional rows reproduce the duplicate at a different row', () => {
  assert.equal(sample.rows.length, 64);
  assert.equal(original.row, 43);
  assert.equal(C.validate(synthetic.data).row, 3);
  assert.equal(C.fingerprintsMatch(original, C.validate(synthetic.data)), true);
});
test('Every data-cell value is replaced with fictional data', () => {
  const forbidden = new Set(sample.rows.flat());
  for (const condition of ['duplicate', 'newline', 'encoding', 'missing']) {
    const repro = C.generateSynthetic(sample, condition);
    assert.ok(repro.data.rows.flat().every(cell => !forbidden.has(cell)));
    for (const value of forbidden) assert.ok(!repro.csv.includes(value));
  }
});
test('Synthetic values avoid collisions with source values and remain deterministic', () => {
  const source = synthetic.data;
  const first = C.generateSynthetic(source, 'duplicate');
  const second = C.generateSynthetic(source, 'duplicate');
  assert.equal(first.csv, second.csv);
  assert.ok(first.data.rows.flat().every(value => !source.rows.flat().includes(value)));
  assert.deepEqual(syntheticFromFile(createCloudPayload(first).synthetic).data, first.data);
});
test('All four errors produce matching validated cloud payloads', () => {
  for (const condition of ['duplicate', 'newline', 'encoding', 'missing']) {
    const source = C.generateSynthetic(sample, condition).data;
    const repro = C.generateSynthetic(source, condition);
    assert.equal(C.fingerprintsMatch(C.validate(source), C.validate(repro.data)), true);
    const payload = createCloudPayload(repro);
    assert.deepEqual(syntheticFromFile(payload.synthetic).data, repro.data);
    assert.deepEqual(payload.syntheticRows.labels, ['Row 1', 'Row 2', 'Row 3']);
    assert.equal(payload.syntheticRows.failureRow, { duplicate: 'Row 3', newline: 'Row 2' }[condition] ?? null);
    assert.deepEqual(payload.syntheticRows.relatedRows, condition === 'duplicate' ? ['Row 2', 'Row 3'] : []);
  }
});
test('Each signature dimension and validator version is required', () => {
  const report = C.validate(synthetic.data);
  for (const key of ['kind', 'field', 'condition']) {
    const changed = copy(report); changed.fingerprint[key] = 'different';
    assert.equal(C.fingerprintsMatch(original, changed), false);
  }
  assert.equal(C.fingerprintsMatch(original, { ...report, version: 'r18' }), false);
  assert.equal(C.fingerprintsMatch({ ...report, ok: true }, { ...report, ok: true }), false);
});
test('Cloud payload allowlist excludes original values and original metadata', () => {
  const source = C.readText('customer_id,name\r\nPRIVATE-ID,Secret Alice\r\nPRIVATE-ID,Secret Bob\r\n');
  source.filename = 'customer-secret.csv';
  source.originalRowNumbers = [42, 43];
  const payload = createCloudPayload(C.generateSynthetic(source, 'duplicate'));
  assert.deepEqual(Object.keys(payload).sort(), ['fingerprint', 'importerCode', 'synthetic', 'syntheticRows']);
  const text = JSON.stringify(payload);
  for (const privateValue of [...source.rows.flat(), source.filename, 'originalRowNumbers']) assert.ok(!text.includes(privateValue));
  assert.equal(payload.fingerprint.version, 'r17');
});
test('Cloud factory rejects renamed customer CSV and custom private column names', () => {
  assert.throws(() => createCloudPayload({ ...synthetic, csv: 'customer_id,name\nPRIVATE-ID,Private Name\nPRIVATE-ID,Private Two\n' }));
  const source = C.readText('customer_id,name,PrivateColumn\nA,B,"secret\nvalue"\n');
  const repro = C.generateSynthetic(source, 'newline');
  assert.equal(C.fingerprintsMatch(C.validate(source), C.validate(repro.data)), false);
  assert.ok(!JSON.stringify(createCloudPayload(repro)).includes('PrivateColumn'));
});
test('Export is blocked without approval and on mismatched signatures', () => {
  assert.throws(() => createShareBundle({ originalReport: original, synthetic, approved: false, report: demoReport(synthetic) }));
  assert.throws(() => createShareBundle({ originalReport: original, synthetic: C.generateSynthetic(sample, 'newline'), approved: true, report: demoReport(synthetic) }));
});
test('Approved bundle strips original report row numbers and rejects extra fields', () => {
  const polluted = { ...original, filename: 'private.csv', rawLogs: 'private', row: 98765 };
  const bundle = createShareBundle({ originalReport: polluted, synthetic, approved: true, report: demoReport(synthetic) });
  const text = JSON.stringify(bundle);
  for (const sentinel of ['private.csv', 'rawLogs', '98765', 'DEMO-FICTION', 'Fictional customer']) assert.ok(!text.includes(sentinel));
  assert.ok(!JSON.stringify(bundle.validation).includes('relatedRows'));
  assert.equal(bundle.syntheticRows, undefined);
  assert.equal(bundle.report.language, undefined);
  assert.throws(() => validateShareBundle({ ...bundle, originalCSV: 'private' }));
  const nested = copy(bundle); nested.validation.original.row = 42;
  assert.throws(() => validateShareBundle(nested));
});
test('Invalid UTF-8 bytes survive Base64 export exactly', () => {
  const repro = C.generateSynthetic(sample, 'encoding');
  const payload = createCloudPayload(repro);
  assert.equal(payload.synthetic.encoding, 'base64');
  assert.deepEqual(syntheticFromFile(payload.synthetic).bytes, repro.bytes);
});
test('Exported importer code executes the same validator', () => {
  const context = vm.createContext({ module: { exports: {} }, TextDecoder });
  vm.runInContext(C.importerCode(), context);
  const importer = context.module.exports;
  assert.deepEqual(JSON.parse(JSON.stringify(importer.validate(importer.readBytes(synthetic.bytes)))), C.validate(synthetic.data));
});
test('Bundle rejects tampered fingerprints importer code and provenance', () => {
  const fixture = demoBundle();
  for (const mutate of [b => b.fingerprint.field = 'name', b => b.importerCode += '\n// injected', b => b.approved = false, b => b.report.inferenceSource = 'in_cloud', b => b.validation.matched = false]) {
    const bundle = copy(fixture); mutate(bundle); assert.throws(() => validateShareBundle(bundle));
  }
});
test('Malformed CSV and excessive rows cannot become a matching failure handoff', () => {
  const broken = C.readText('customer_id,name\n"broken');
  assert.equal(C.validate(broken).fingerprint.kind, 'CSV_FORMAT');
  assert.equal(C.fingerprintsMatch(C.validate(broken), C.validate(C.generateSynthetic(broken, 'duplicate').data)), false);
  const large = C.readText('customer_id,name\n' + 'A,B\n'.repeat(10001));
  assert.equal(C.validate(large).fingerprint.condition, 'row_limit');
});

test('Known customer_id missing-column and newline failures preserve their fields at sharing boundary', () => {
  for (const [csv, condition] of [['name\nPrivate Name\n', 'missing'], ['customer_id,name\n"Private\nID",Private Name\n', 'newline']]) {
    const source = C.readText(csv);
    const repro = C.generateSynthetic(source, condition);
    const payload = createCloudPayload(repro);
    assert.equal(payload.fingerprint.field, 'customer_id');
    assert.equal(C.fingerprintsMatch(C.validate(source), C.validate(repro.data)), true);
    const bundle = createShareBundle({ originalReport: C.validate(source), synthetic: repro, approved: true, report: demoReport(repro) });
    assert.ok(!JSON.stringify(bundle).includes('Private Name'));
  }
});
