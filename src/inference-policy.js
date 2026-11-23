// The single executable feature policy table. Every model is constructed from this table.
export const FEATURES = Object.freeze({
  candidates: Object.freeze({ mode: 'ONLY_ON_DEVICE', inputs: Object.freeze(['originalSummary']), private: true }),
  draft: Object.freeze({ mode: 'ONLY_IN_CLOUD', inputs: Object.freeze(['synthetic', 'importerCode', 'fingerprint']), private: false }),
  rewrite: Object.freeze({ mode: 'PREFER_ON_DEVICE', inputs: Object.freeze(['draft']), private: false })
});
const originalInputs = new Set(['originalCSV', 'originalSummary', 'originalRows', 'originalValues', 'originalFilename', 'originalRowNumbers']);
export function assertPolicy(table = FEATURES) {
  for (const [name, rule] of Object.entries(table)) {
    if (!['ONLY_ON_DEVICE', 'ONLY_IN_CLOUD', 'PREFER_ON_DEVICE'].includes(rule.mode)) throw new Error(`INVALID_MODE:${name}`);
    if ((rule.private || rule.inputs.some(input => originalInputs.has(input) || /^original/i.test(input))) && rule.mode !== 'ONLY_ON_DEVICE') throw new Error(`PRIVATE_INPUT_MODE:${name}`);
    if (rule.inputs.some(input => !originalInputs.has(input) && !['synthetic', 'importerCode', 'fingerprint', 'draft'].includes(input))) throw new Error(`UNKNOWN_INPUT:${name}`);
  }
  if (table.candidates?.mode !== 'ONLY_ON_DEVICE' || table.draft?.mode !== 'ONLY_IN_CLOUD' || table.rewrite?.mode !== 'PREFER_ON_DEVICE') throw new Error('FEATURE_MODE');
  return true;
}
assertPolicy();
export function policyFor(feature) {
  assertPolicy();
  if (!Object.hasOwn(FEATURES, feature)) throw new Error('UNKNOWN_FEATURE');
  return FEATURES[feature];
}
export function localSummary(source, result) {
  // This object is private even though it deliberately excludes actual cell values and metadata.
  return {
    columns: source.headers.map((name, index) => ({ name, type: source.rows.every(row => /^-?\d+(\.\d+)?$/.test(row[index])) ? 'number-like' : 'text' })),
    encodingValid: source.encodingValid,
    parseError: source.parseError,
    checks: result.checks,
    problemShape: result.fingerprint ? { ...result.fingerprint, affectedRecords: result.relatedRows.length || (result.row ? 1 : 0) } : null
  };
}
export function serialQueue() {
  let tail = Promise.resolve();
  return task => {
    const current = tail.then(task);
    tail = current.catch(() => {});
    return current;
  };
}
export async function candidateOutcome(infer, summary) {
  try {
    const answer = await infer('candidates', summary);
    if (answer.inferenceSource !== 'on_device') throw new Error('LOCAL_SOURCE_REQUIRED');
    const parsed = JSON.parse(answer.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (!Array.isArray(parsed.candidates) || !parsed.candidates.length) throw new Error('INVALID_CANDIDATES');
    const candidates = parsed.candidates.slice(0, 4).map(item => {
      if (!['duplicate', 'newline', 'encoding', 'missing'].includes(item.condition) || !['likely', 'possible', 'unlikely'].includes(item.confidence)) throw new Error('INVALID_CANDIDATES');
      return { condition: item.condition, confidence: item.confidence };
    });
    return { status: 'ready', candidates, inferenceSource: answer.inferenceSource };
  } catch {
    // No cloud retry path exists for private inputs. Error details may contain private data.
    return { status: 'manual', candidates: [], inferenceSource: null };
  }
}
