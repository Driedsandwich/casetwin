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
export const candidateConditions = Object.freeze(['duplicate', 'newline', 'encoding', 'missing']);
export const candidateConfidences = Object.freeze(['likely', 'possible', 'unlikely']);

export class LocalInferenceError extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function firstJsonObject(text) {
  // A JSON object starts with a quoted key or is empty. Skip quoted values when counting braces.
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}]/g;
  for (const { index: start } of text.matchAll(/\{(?=\s*["}])/g)) {
    let depth = 1;
    tokens.lastIndex = start + 1;
    for (let token; (token = tokens.exec(text));) {
      if (token[0] === '{') depth++;
      else if (token[0] === '}') depth--;
      if (depth === 0) {
        try { return JSON.parse(text.slice(start, tokens.lastIndex)); }
        catch { break; }
      }
    }
  }
}

export async function candidateOutcome(infer, summary, timeoutMs = 60_000) {
  const controller = new AbortController();
  let timer;
  try {
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const error = new LocalInferenceError('timeout');
        controller.abort(error);
        reject(error);
      }, timeoutMs);
    });
    const answer = await Promise.race([infer('candidates', summary, controller.signal), timeout]);
    if (answer?.inferenceSource !== 'on_device' || typeof answer.text !== 'string') throw new LocalInferenceError('invalid-answer');
    const parsed = firstJsonObject(answer.text);
    if (!Array.isArray(parsed?.candidates)) throw new LocalInferenceError('invalid-answer');
    const candidates = [];
    for (const item of parsed.candidates) {
      const condition = typeof item?.condition === 'string' && item.condition.trim().toLowerCase();
      const confidence = typeof item?.confidence === 'string' && item.confidence.trim().toLowerCase();
      if (!candidateConditions.includes(condition) || !candidateConfidences.includes(confidence)) continue;
      candidates.push({ condition, confidence });
      if (candidates.length === candidateConditions.length) break;
    }
    if (!candidates.length) throw new LocalInferenceError('invalid-answer');
    return { status: 'ready', candidates, inferenceSource: answer.inferenceSource };
  } catch (error) {
    // No cloud retry path exists for private inputs. Error details may contain private data.
    const reason = error instanceof LocalInferenceError ? error.reason : error?.name === 'TimeoutError' ? 'timeout' : 'unavailable';
    return { status: 'manual', reason, candidates: [], inferenceSource: null };
  } finally {
    clearTimeout(timer);
  }
}
