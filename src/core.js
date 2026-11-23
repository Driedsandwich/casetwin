// Extracted verbatim from prototype/index.html. Do not change the deterministic core.

'use strict';
const CaseTwinCore = (() => {
  const VERSION = 'r17';
  const REQUIRED = ['customer_id', 'name'];
  function encodeCSV(headers, rows) {
    const quote = value => /[",\r\n]/.test(String(value)) ? '"' + String(value).replace(/"/g, '""') + '"' : String(value);
    return [headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n') + '\r\n';
  }
  function parseCSV(text) {
    text = text.replace(/^\uFEFF/, '');
    const records = []; let row = [], cell = '', mode = 'start';
    const pushCell = () => { row.push(cell); cell = ''; mode = 'start'; };
    const pushRow = () => { pushCell(); if (!(row.length === 1 && row[0] === '')) records.push(row); row = []; if (records.length > 10001) throw new Error('TOO_MANY_ROWS'); };
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (mode === 'quoted') {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else mode = 'closed'; }
        else cell += ch;
      } else if (ch === ',') pushCell();
      else if (ch === '\r' || ch === '\n') { pushRow(); if (ch === '\r' && text[i + 1] === '\n') i++; }
      else if (ch === '"' && mode === 'start') mode = 'quoted';
      else { if (mode === 'closed' || ch === '"') throw new Error('CSV_FORMAT'); cell += ch; mode = 'plain'; }
    }
    if (mode === 'quoted') throw new Error('CSV_FORMAT');
    if (cell !== '' || row.length || mode !== 'start') pushRow();
    const headers = records.shift() || [];
    if (new Set(headers).size !== headers.length || records.some(r => r.length !== headers.length)) throw new Error('CSV_FORMAT');
    return { headers, rows: records };
  }
  function decodeBytes(bytes) {
    let encodingValid = true, text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch (_) { encodingValid = false; text = new TextDecoder('utf-8').decode(bytes); }
    return { text, encodingValid };
  }
  function readBytes(bytes) {
    const decoded = decodeBytes(bytes);
    try { return { ...decoded, ...parseCSV(decoded.text), parseError: null }; }
    catch (e) { return { ...decoded, headers: [], rows: [], parseError: e.message }; }
  }
  function readText(text) { return readBytes(new TextEncoder().encode(text)); }
  function validate(source) {
    const checks = { encoding: 'not_run', required: 'not_run', newline: 'not_run', duplicate: 'not_run' };
    const fail = (kind, field, condition, row = null, relatedRows = []) => ({ ok: false, version: VERSION, fingerprint: { kind, field, condition }, row, relatedRows, checks });
    if (!source.encodingValid) { checks.encoding = 'fail'; return fail('INVALID_ENCODING', '*', 'invalid_utf8'); }
    checks.encoding = 'pass';
    if (source.parseError) return fail('CSV_FORMAT', '*', source.parseError === 'TOO_MANY_ROWS' ? 'row_limit' : 'malformed_csv');
    for (const field of REQUIRED) if (!source.headers.includes(field)) { checks.required = 'fail'; return fail('MISSING_COLUMN', field, 'required_column'); }
    checks.required = 'pass';
    for (let i = 0; i < source.rows.length; i++) for (let j = 0; j < source.headers.length; j++) {
      if (/[\r\n]/.test(source.rows[i][j])) { checks.newline = 'fail'; return fail('EMBEDDED_NEWLINE', source.headers[j], 'embedded_newline', i + 1); }
    }
    checks.newline = 'pass';
    const index = source.headers.indexOf('customer_id'), seen = new Map();
    for (let i = 0; i < source.rows.length; i++) {
      const key = source.rows[i][index];
      if (seen.has(key)) { checks.duplicate = 'fail'; return fail('DUPLICATE_KEY', 'customer_id', 'repeated_key', i + 1, [seen.get(key), i + 1]); }
      seen.set(key, i + 1);
    }
    checks.duplicate = 'pass';
    return { ok: true, version: VERSION, fingerprint: null, row: null, relatedRows: [], checks };
  }
  function fingerprintsMatch(original, synthetic) {
    if (!original || !synthetic || original.ok || synthetic.ok || original.version !== synthetic.version) return false;
    return ['kind', 'field', 'condition'].every(key => original.fingerprint[key] === synthetic.fingerprint[key]);
  }
  function makeSample() {
    const rows = Array.from({ length: 64 }, (_, i) => ['DEMO-FICTION-' + String(i === 42 ? 42 : i + 1).padStart(4, '0'), 'Fictional customer ' + String(i + 1).padStart(3, '0')]);
    return readText(encodeCSV(REQUIRED, rows));
  }
  function generateSynthetic(original, condition) {
    if (!['duplicate', 'newline', 'missing', 'encoding'].includes(condition)) throw new Error('UNKNOWN_CONDITION');
    const forbidden = new Set(original.rows.flat());
    const report = validate(original);
    const field = ['customer_id', 'name'].includes(report.fingerprint?.field) ? report.fingerprint.field : 'name';
    let attempt = 0;
    for (;;) {
      const salt = attempt ? '-' + attempt : '';
      const id = n => 'SYN-FICTION' + salt + '-' + String(n).padStart(3, '0');
      const name = n => 'Fictional synthetic' + salt + ' ' + String.fromCharCode(64 + n);
      let headers = [...REQUIRED];
      let rows = [[id(1), name(1)], [id(2), name(2)], [id(3), name(3)]];
      if (condition === 'duplicate') rows[2][0] = rows[1][0];
      if (condition === 'newline') rows[1][headers.indexOf(field)] += '\nFictional second line' + salt;
      if (condition === 'missing') { const j = headers.indexOf(field); headers.splice(j, 1); rows = rows.map(row => row.filter((_, k) => k !== j)); }
      let csv = encodeCSV(headers, rows), bytes = new TextEncoder().encode(csv);
      if (condition === 'encoding') {
        const marker = bytes.length - 2;
        bytes = new Uint8Array([...bytes.slice(0, marker), 255, ...bytes.slice(marker)]);
      }
      const data = readBytes(bytes);
      if (!data.rows.flat().some(value => forbidden.has(value))) return { csv: data.text, bytes, data, condition };
      attempt++;
    }
  }
  function safeReport(report) {
    return { ok: report.ok, version: report.version, fingerprint: report.fingerprint && { ...report.fingerprint }, checks: { ...report.checks } };
  }
  function importerCode() {
    return "'use strict';\nconst VERSION = 'r17';\nconst REQUIRED = ['customer_id', 'name'];\n" + [parseCSV, decodeBytes, readBytes, validate].map(fn => fn.toString()).join('\n\n') + '\n\n// Node: validate(readBytes(require("node:fs").readFileSync(path)))\nif (typeof module !== "undefined") module.exports = { readBytes, validate };\n';
  }
  function buildBundle(originalReport, synthetic, approved, draft) {
    const syntheticReport = validate(synthetic.data);
    if (!approved || !fingerprintsMatch(originalReport, syntheticReport)) throw new Error('HANDOFF_NOT_APPROVED');
    const validation = { matched: true, original: safeReport(originalReport), synthetic: safeReport(syntheticReport) };
    // Original CSV, names, values, row numbers and file metadata never enter this allowlist.
    const csvFile = synthetic.condition === 'encoding'
      ? { encoding: 'base64', content: bytesToBase64(synthetic.bytes) }
      : { encoding: 'utf-8', content: synthetic.csv };
    return { prototype: true, sent: false, files: { 'repro-synthetic.csv': csvFile, 'importer-r17.cjs': { encoding: 'utf-8', content: importerCode() }, 'validation.json': { encoding: 'utf-8', content: JSON.stringify(validation, null, 2) }, 'report-draft.txt': { encoding: 'utf-8', content: draft } } };
  }
  function bytesToBase64(bytes) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += chars[(n >>> 18) & 63] + chars[(n >>> 12) & 63] + (i + 1 < bytes.length ? chars[(n >>> 6) & 63] : '=') + (i + 2 < bytes.length ? chars[n & 63] : '=');
    }
    return out;
  }
  return { VERSION, REQUIRED, encodeCSV, parseCSV, readBytes, readText, validate, fingerprintsMatch, makeSample, generateSynthetic, safeReport, importerCode, buildBundle };
})();

export default CaseTwinCore;
