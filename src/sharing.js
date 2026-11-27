import C from './core.js';

const kinds = {
  DUPLICATE_KEY: ['customer_id', 'repeated_key'],
  EMBEDDED_NEWLINE: [['customer_id', 'name'], 'embedded_newline'],
  MISSING_COLUMN: [['customer_id', 'name'], 'required_column'],
  INVALID_ENCODING: ['*', 'invalid_utf8']
};
const clone = value => JSON.parse(JSON.stringify(value));
function exactKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('|') !== [...keys].sort().join('|')) throw new Error('UNSAFE_BUNDLE_SCHEMA');
}
function checkFingerprint(fp) {
  exactKeys(fp, ['kind', 'field', 'condition', 'version']);
  const rule = kinds[fp.kind];
  if (!rule || fp.version !== 'r17' || ![rule[0]].flat().includes(fp.field) || fp.condition !== rule[1]) throw new Error('UNSUPPORTED_FINGERPRINT');
}
function csvFile(synthetic) {
  return synthetic.condition === 'encoding'
    ? { encoding: 'base64', content: btoa(String.fromCharCode(...synthetic.bytes)) }
    : { encoding: 'utf-8', content: synthetic.csv };
}
export function syntheticFromFile(file) {
  exactKeys(file, ['encoding', 'content']);
  if (typeof file.content !== 'string' || file.content.length > 20000 || !['utf-8', 'base64'].includes(file.encoding)) throw new Error('INVALID_SYNTHETIC');
  let bytes;
  try { bytes = file.encoding === 'base64' ? Uint8Array.from(atob(file.content), ch => ch.charCodeAt(0)) : new TextEncoder().encode(file.content); }
  catch { throw new Error('INVALID_SYNTHETIC'); }
  const data = C.readBytes(bytes);
  // Accept only exact outputs of the deterministic generator, including collision salts.
  // This rejects a customer CSV renamed to repro-synthetic.csv.
  const first = data.rows[0]?.[0] || '';
  const salt = first.match(/^(?:SYN-FICTION|Fictional synthetic)(-\d+)?(?:-| )/u)?.[1] || '';
  if (!/^(-[1-9]\d{0,5})?$/.test(salt)) throw new Error('INVALID_SYNTHETIC');
  const id = n => `SYN-FICTION${salt}-${String(n).padStart(3, '0')}`;
  const name = n => `Fictional synthetic${salt} ${String.fromCharCode(64 + n)}`;
  const possibilities = [];
  for (const condition of ['duplicate', 'newline', 'missing', 'encoding']) {
    for (const field of ['customer_id', 'name']) {
      let headers = ['customer_id', 'name'];
      let rows = [[id(1), name(1)], [id(2), name(2)], [id(3), name(3)]];
      if (condition === 'duplicate') rows[2][0] = rows[1][0];
      if (condition === 'newline') rows[1][headers.indexOf(field)] += '\nFictional second line' + salt;
      if (condition === 'missing') { const index = headers.indexOf(field); headers.splice(index, 1); rows = rows.map(row => row.filter((_, i) => i !== index)); }
      let expected = new TextEncoder().encode(C.encodeCSV(headers, rows));
      if (condition === 'encoding') expected = new Uint8Array([...expected.slice(0, -2), 255, ...expected.slice(-2)]);
      possibilities.push({ expected, condition });
    }
  }
  const match = possibilities.find(({ expected }) => expected.length === bytes.length && expected.every((byte, index) => byte === bytes[index]));
  if (!match || (match.condition === 'encoding') !== (file.encoding === 'base64')) throw new Error('NON_FICTIONAL_REPRO');
  return { data, bytes, csv: data.text, condition: match.condition };
}

export const syntheticRowLabel = row => `Row ${row}`;

// The ONLY factory for cloud model input. It accepts synthetic data, never original metadata.
export function createCloudPayload(synthetic) {
  const file = csvFile(synthetic);
  const checked = syntheticFromFile(file);
  const report = C.validate(checked.data);
  const fingerprint = { ...report.fingerprint, version: report.version };
  checkFingerprint(fingerprint);
  const syntheticRows = {
    labels: checked.data.rows.map((_, index) => syntheticRowLabel(index + 1)),
    failureRow: report.row ? syntheticRowLabel(report.row) : null,
    relatedRows: report.relatedRows.map(syntheticRowLabel)
  };
  return { synthetic: file, importerCode: C.importerCode(), fingerprint, syntheticRows };
}

export function createShareBundle({ originalReport, synthetic, approved, report, createdAt = new Date().toISOString() }) {
  const syntheticReport = C.validate(synthetic.data);
  if (!approved || !C.fingerprintsMatch(originalReport, syntheticReport)) throw new Error('HANDOFF_NOT_APPROVED');
  const { synthetic: file, importerCode, fingerprint } = createCloudPayload(synthetic);
  // Both reports are reconstructed from synthetic data because their safe signatures match.
  // No original object is spread into the outgoing data.
  const safe = C.safeReport(syntheticReport);
  return validateShareBundle({ schemaVersion: 1, approved: true, synthetic: file, importerCode, fingerprint,
    validation: { matched: true, original: clone(safe), synthetic: clone(safe) },
    report: { text: report.text, inferenceSource: report.inferenceSource, simulated: report.simulated }, createdAt });
}
export function validateShareBundle(bundle) {
  exactKeys(bundle, ['schemaVersion', 'approved', 'synthetic', 'importerCode', 'fingerprint', 'validation', 'report', 'createdAt']);
  if (bundle.schemaVersion !== 1 || bundle.approved !== true) throw new Error('UNAPPROVED_BUNDLE');
  checkFingerprint(bundle.fingerprint);
  const synthetic = syntheticFromFile(bundle.synthetic);
  const result = C.validate(synthetic.data);
  const expected = { ...result.fingerprint, version: result.version };
  if (JSON.stringify(bundle.fingerprint) !== JSON.stringify(expected)) throw new Error('FINGERPRINT_MISMATCH');
  if (bundle.importerCode !== C.importerCode()) throw new Error('UNTRUSTED_IMPORTER');
  exactKeys(bundle.validation, ['matched', 'original', 'synthetic']);
  if (bundle.validation.matched !== true) throw new Error('FINGERPRINT_MISMATCH');
  for (const key of ['original', 'synthetic']) {
    const report = bundle.validation[key];
    exactKeys(report, ['ok', 'version', 'fingerprint', 'checks']);
    exactKeys(report.fingerprint, ['kind', 'field', 'condition']);
    exactKeys(report.checks, ['encoding', 'required', 'newline', 'duplicate']);
    if (JSON.stringify(report) !== JSON.stringify(C.safeReport(result))) throw new Error('UNSAFE_VALIDATION');
  }
  exactKeys(bundle.report, ['text', 'inferenceSource', 'simulated']);
  if (typeof bundle.report.text !== 'string' || bundle.report.text.length > 20000 || !bundle.report.text.trim()) throw new Error('INVALID_REPORT');
  if (![null, 'on_device', 'in_cloud'].includes(bundle.report.inferenceSource) || typeof bundle.report.simulated !== 'boolean' || (bundle.report.simulated ? bundle.report.inferenceSource !== null : !bundle.report.inferenceSource)) throw new Error('INVALID_PROVENANCE');
  if (typeof bundle.createdAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(bundle.createdAt) || Number.isNaN(Date.parse(bundle.createdAt))) throw new Error('INVALID_TIMESTAMP');
  return clone(bundle);
}
export function demoReport(synthetic, language = 'en') {
  const kind = C.validate(synthetic.data).fingerprint.kind;
  const description = {
    DUPLICATE_KEY: ['Duplicate customer_id rejects CSV import', 'Detect duplicate keys before writes and confirm the intended duplicate policy.'],
    EMBEDDED_NEWLINE: ['Embedded newline rejects CSV import', 'Confirm whether newlines in quoted cells should be allowed.'],
    MISSING_COLUMN: ['Missing required column rejects CSV import', 'Show the required column names before import.'],
    INVALID_ENCODING: ['Invalid UTF-8 rejects CSV import', 'Explain the UTF-8 requirement without silently replacing invalid bytes.']
  }[kind];
  const text = language === 'ja'
    ? `下書き · 見本\n\n根拠: 架空の再現に対して検査 r17 が ${kind} を返しました。\n\n見立て: 該当する検査の拒否条件で取り込みが止まる可能性があります。\n\n直し方の案: 仕様を確認し書き込み前に検出して対象の列を説明します。\n\n回帰の確認: 架空の再現を修正後の検査に通します。実サービスの動作は未確認です。`
    : `DRAFT · ${description[0]}\n\nEvidence: The fictional reproduction returns ${kind} under validator r17.\n\nHypothesis: This validation rule may stop the import. Production service behavior is unverified.\n\nSuggested fix: ${description[1]}\n\nRegression check: Run the synthetic CSV against the patch and check the intended policy and absence of partial writes.`;
  return { text, inferenceSource: null, simulated: true, language };
}
export function demoBundle() {
  const original = C.makeSample();
  const synthetic = C.generateSynthetic(original, 'duplicate');
  return createShareBundle({ originalReport: C.validate(original), synthetic, approved: true, report: demoReport(synthetic), createdAt: '2026-01-01T00:00:00.000Z' });
}
