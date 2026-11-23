import C from './core.js';
import { config } from './config.js';
import { translate } from './i18n.js';
import { candidateOutcome, localSummary } from './inference-policy.js';
import { createShareBundle, createCloudPayload, demoReport } from './sharing.js';

const sample = C.makeSample();
export const state = { lang: 'en', source: sample, filename: 'fictional-demo.csv', original: C.validate(sample), synthetic: null, syntheticReport: null, condition: '', view: 'main', approved: false, cloudApproved: false, report: null, candidates: [], aiStatus: 'idle', inferenceSource: null, progress: null, notice: '', work: '', signedIn: false };
let revision = 0, aiRevision = 0, fileRevision = 0;
let firstLocalCall = true;
const t = key => translate(state.lang, key);
export const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const icon = name => `<svg class="icon" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
const btn = (action, key, { primary = false, disabled = false, symbol = '' } = {}) => `<button type="button" data-action="${action}" ${primary ? 'class="primary"' : ''} ${disabled ? 'disabled' : ''}>${symbol ? icon(symbol) : ''}${esc(t(key))}</button>`;
export const matched = () => C.fingerprintsMatch(state.original, state.syntheticReport);
const busy = () => Boolean(state.work);
const inferenceLabel = report => report?.simulated ? t('simulated') : `${t('source')}: ${report?.inferenceSource || t('noneSource')}`;
function status(report) {
  if (!report) return '';
  return `<div class="status-line ${report.ok ? 'pass' : ''}">${icon(report.ok ? 'check' : 'alert')}${report.ok ? 'PASS' : 'FAIL · ' + esc(report.fingerprint.kind)}</div>`;
}
function table(data, report, privateData = false) {
  if (!data?.headers.length) return `<p class="note">${t('noPreview')}</p>`;
  const focus = report?.relatedRows?.length ? report.relatedRows : report?.row ? [report.row] : [];
  const indexes = privateData && focus.length ? focus.map(n => n - 1) : data.rows.slice(0, privateData ? 4 : 3).map((_, i) => i);
  return `<div class="table-wrap"><table><caption class="visually-hidden">${t(privateData ? 'localPreview' : 'syntheticPreview')}</caption><thead><tr><th scope="col">#</th>${data.headers.slice(0, 3).map(header => `<th scope="col">${esc(header)}</th>`).join('')}</tr></thead><tbody>${indexes.map(i => `<tr class="${focus.includes(i + 1) ? 'marked' : ''}"><td>${i + 1}</td>${data.rows[i].slice(0, 3).map(cell => `<td>${esc(cell.length > 85 ? cell.slice(0, 85) + '…' : cell)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function originalPanel() {
  return `<section class="panel panel-pad"><div class="panel-head">${icon('file')}<div><h2>${t('original')}</h2><div class="badges"><span class="badge private">${t('private')}</span><span class="badge">${t('onDevice')}</span></div></div></div>
  <p class="file-name">${esc(state.filename)}</p><p class="meta">${state.source?.rows.length || 0} ${t('rows')} · ${t('noUpload')}</p>
  ${state.view === 'main' ? `<div class="load-actions">${btn('sample', 'load', { disabled: busy() })}<label class="file-label">${t('chooseFile')}<input id="csv-file" type="file" accept=".csv,text/csv" aria-label="${t('chooseFile')}" ${busy() ? 'disabled' : ''}></label></div><p class="small">${t('fileHelp')}</p>` : ''}
  ${state.source ? status(state.original) + table(state.source, state.original, true) + `<p class="note">${t('focusNote')}</p>` : `<p class="empty">${t('noSource')}</p>`}</section>`;
}
function conditionPicker() {
  return `<label class="field-label" for="condition">${t('conditionSelect')}</label><select id="condition" ${!state.source || busy() ? 'disabled' : ''}><option value="">${t('chooseCondition')}</option>${['duplicate', 'newline', 'encoding', 'missing'].map(key => `<option value="${key}" ${state.condition === key ? 'selected' : ''}>${t(key)}</option>`).join('')}</select>`;
}
function candidatesPanel() {
  const pending = ['preparing', 'analyzing'].includes(state.aiStatus);
  const info = pending ? t(state.aiStatus) : state.aiStatus === 'manual' ? t('unavailable') : t('candidateHelp');
  return `<section class="panel candidates"><div class="title-row">${icon('spark')}<h3>${t('localCandidates')}</h3></div>
  <span class="badge">ONLY_ON_DEVICE</span><p class="small" role="status">${info}${pending && state.progress !== null ? ` (${state.progress}%)` : ''}</p>
  ${state.candidates.length ? `<ul class="candidate-list">${state.candidates.map(item => `<li class="${item.confidence === 'likely' ? 'chosen' : ''}">${icon(item.confidence === 'likely' ? 'check' : 'code')}<span>${t(item.condition)} · ${t(item.confidence)}</span></li>`).join('')}</ul>` : ''}
  <p class="source-label">${esc(inferenceLabel({ inferenceSource: state.inferenceSource }))}</p>
  <div class="candidate-actions">${btn('analyze', 'analyze', { disabled: !state.source || pending || busy(), symbol: 'spark' })}${btn('manual', 'manual', { disabled: !state.source || busy() })}</div>${conditionPicker()}</section>`;
}
function validationPanel() {
  return `<section class="panel candidates"><div class="title-row">${icon('shield')}<h3>${t('validation')}</h3></div><dl class="details">${Object.entries(state.original?.checks || {}).map(([key, value]) => `<div><dt>${t(key)}</dt><dd><span class="check-${value}">${t(value)}</span></dd></div>`).join('')}</dl><p class="small">${t('checksNote')}</p></section>`;
}
function matchCard(privateData) {
  const report = privateData ? state.original : state.syntheticReport;
  return `<div class="match-card"><span class="small">${t(privateData ? 'originalMatch' : 'syntheticMatch')}</span><strong>${report ? report.row ? `${t('row')} ${report.row}` : t('wholeFile') : t('awaiting')}</strong>${report ? `<span class="badge ${report.ok ? 'pass' : 'fail'}">${report.ok ? 'PASS' : 'FAIL'}</span><br><code>${esc(report.fingerprint?.kind || '—')}</code>` : ''}${state.view === 'review' ? `<dl class="details"><div><dt>CSV</dt><dd>${esc(privateData ? state.filename : 'repro-synthetic.csv')}</dd></div><div><dt>${t('validator')}</dt><dd>r17</dd></div></dl>` : ''}</div>`;
}
function fingerprintPanel() {
  const fp = state.original?.fingerprint;
  return `<section class="panel fingerprint"><div class="fingerprint-head"><h2>${t('fingerprint')}</h2></div><div class="fingerprint-body"><div class="error-kind ${fp ? '' : 'idle'}">${esc(fp?.kind || t(state.original?.ok ? 'noFailure' : 'noSource'))}</div>
  <dl class="finger-fields"><div><dt>${t('field')}</dt><dd>${esc(fp?.field || '—')}</dd></div><div><dt>${t('condition')}</dt><dd>${fp ? esc(t(fp.condition)) : '—'}</dd></div><div><dt>${t('validator')}</dt><dd>r17 <span class="badge">${t('sameCode')}</span></dd></div></dl>
  <div class="matches">${matchCard(true)}${matchCard(false)}</div><div class="join" aria-hidden="true"><svg viewBox="0 0 300 42"><path d="M75 0v9q0 10 18 10h39q18 0 18 12M225 0v9q0 10-18 10h-39q-18 0-18 12M150 28v8m-5-5 5 6 5-6" fill="none" stroke="#8c93a3" stroke-width="1.5"/></svg></div>
  <div class="result ${state.synthetic ? matched() ? 'success' : 'failure' : ''}" role="status"><strong>${icon(state.synthetic ? matched() ? 'check' : 'alert' : 'shield')}${t(state.synthetic ? matched() ? 'sameFailure' : 'differentFailure' : 'compare')}</strong><p>${t(state.synthetic ? matched() ? 'matchDetail' : 'mismatchDetail' : 'waitingDetail')}</p></div><p class="finger-caption">${t('caption')}</p></div></section>`;
}
function reportPanel() {
  return `<section class="report"><div class="title-row">${icon('cloud')}<h3>${t('draft')}</h3></div><span class="badge">${t('draftBadge')}</span>
  ${state.report ? `<p class="source-label">${esc(inferenceLabel(state.report))}</p><div class="report-text">${esc(state.report.text)}</div><p class="hypothesis">${t('hypothesis')}</p><p class="small">${t('rewriteNote')}</p>${btn('rewrite', 'rewrite', { disabled: busy(), symbol: 'spark' })}` : `<p class="note">${t('cloudPending')}</p>`}</section>`;
}
function syntheticPanel() {
  return `<section class="panel panel-pad"><div class="panel-head">${icon('file')}<div><h2>${t('synthetic')}</h2><span class="badge">${t('shareable')}</span></div></div>
  ${state.synthetic ? `<p class="file-name">repro-synthetic.csv</p><p class="meta">3 ${t('rows')}</p>${status(state.syntheticReport)}${table(state.synthetic.data, state.syntheticReport)}<p class="note">${t('syntheticNote')}${state.synthetic.condition === 'encoding' ? '<br>' + t('invalidBytes') : ''}</p>` : `<div class="empty">${icon('file')}${t('syntheticEmpty')}</div>`}
  ${state.view === 'review' ? reportPanel() : ''}</section>`;
}
function generatorPanel() {
  return `<section class="panel generator"><div class="title-row">${icon('settings')}<h3>${t('generator')}</h3></div><p>${t('generatorText')}</p><div class="algorithm"><span>${t('condition')}</span>→<span>${t('synthetic')}</span>→<span>r17</span></div></section>`;
}
function actions() {
  return `<div class="action-bar"><div class="validator">${icon('shield')}<span>${t('sameValidator')}<br><span class="small">${t('localWork')}</span></span></div><div class="action-buttons">${btn('rerun', 'run', { disabled: !state.synthetic || busy(), symbol: 'refresh' })}${btn('generate', 'create', { primary: !matched(), disabled: !state.source || !state.condition || busy(), symbol: 'spark' })}${btn('review', 'review', { primary: matched(), disabled: !matched() || busy(), symbol: 'arrow' })}</div></div>`;
}
function transfer() {
  return `<div class="transfer"><section class="privacy-card"><h3>${icon('cloud')}${t('leaves')}</h3><ul>${['leaves1', 'leaves2', 'leaves3', 'leaves4'].map(key => `<li>${t(key)}</li>`).join('')}</ul><p>${t('transferNote')}</p></section><section class="privacy-card"><h3>${icon('lock')}${t('stays')}</h3><ul>${['stays1', 'stays2', 'stays3'].map(key => `<li>${t(key)}</li>`).join('')}</ul><p>${t('privacyFooter')}</p></section></div>
  <details class="payload-preview"><summary>${t('cloudPayload')}</summary><pre>${esc(JSON.stringify(createCloudPayload(state.synthetic), null, 2))}</pre></details>
  ${!config.demo ? `<div class="cloud-consent"><label class="confirm"><input id="cloud-approval" type="checkbox" ${state.cloudApproved ? 'checked' : ''} ${busy() ? 'disabled' : ''}>${t('cloudConsent')}</label>${btn('draft', 'generateDraft', { disabled: !state.cloudApproved || busy() })}</div>` : ''}`;
}
function reviewActions() {
  const allowed = state.approved && matched() && state.report && !busy();
  return `<div class="action-bar review-actions"><div><label class="confirm"><input id="approval" type="checkbox" ${state.approved ? 'checked' : ''} ${!state.report || busy() ? 'disabled' : ''}>${t('approval')}</label><p class="small">${t('transferNote')}</p></div><div class="action-buttons">${btn('back', 'back', { disabled: busy() })}${btn('preview', 'preview', { disabled: !allowed })}${btn('export', 'export', { disabled: !allowed, primary: true, symbol: 'file' })}</div></div><div class="save-row"><p class="small">${config.demo ? t('demoSettings') : t('authHelp')}</p>${!config.demo && !state.signedIn ? btn('sign-in', 'signIn', { disabled: busy() }) : ''}${btn('save', 'save', { disabled: !allowed || (!config.demo && !state.signedIn), symbol: 'cloud' })}</div>`;
}
export function render() {
  document.documentElement.lang = state.lang;
  document.title = t('title');
  const review = state.view === 'review';
  document.getElementById('app').innerHTML = `<header class="top"><div class="brand">${icon('logo')}CaseTwin<small>${t('context')}</small></div><div class="head-actions"><div class="language" role="group" aria-label="Language"><button data-action="en" aria-pressed="${state.lang === 'en'}">EN</button><span aria-hidden="true">/</span><button data-action="ja" aria-pressed="${state.lang === 'ja'}">日本語</button></div>${btn('settings', 'settings', { symbol: 'settings' })}</div></header>
  ${config.demo ? `<aside class="demo-banner">${icon('cloud')}<strong>${t('demo')}</strong>${config.partial ? `<span>${t('partial')}</span>` : ''}</aside>` : ''}
  ${state.lang === 'ja' ? `<aside class="guide">${t('guide')}</aside>` : ''}
  <main class="shell"><div class="page-heading"><div><div class="eyebrow">${review ? 'REVIEW / HANDOFF' : t('step')}</div><h1 tabindex="-1">${t(review ? 'reviewHeadline' : 'headline')}</h1><p class="subheading">${t(review ? 'reviewSubheading' : 'subheading')}</p></div></div>
  <div class="environment"><div class="boundary"><span>${icon('laptop')}<strong>LOCAL</strong> · ${t('localBoundary')}</span><span>${icon('cloud')}<strong>CLOUD</strong> · ${t('cloudBoundary')}</span></div></div>
  ${state.notice || state.work ? `<div class="toast ${['tooLarge', 'readError', 'cloudError'].includes(state.notice) ? 'error' : ''}" role="status">${esc(t(state.work || state.notice))}</div>` : ''}
  <div class="workspace ${review ? 'review-grid' : ''}"><div class="side-stack">${originalPanel()}${review ? validationPanel() : candidatesPanel()}</div>${fingerprintPanel()}<div class="side-stack">${syntheticPanel()}${review ? '' : generatorPanel()}</div></div>${review ? transfer() + reviewActions() : actions()}</main><footer class="footer"><span>${icon('lock')}${t('privacyFooter')}</span><span>${t('scopeFooter')}</span></footer>`;
}
function refresh() {
  render();
  document.getElementById('announcement').textContent = state.notice ? t(state.notice) : '';
}
function invalidate() {
  revision++;
  state.synthetic = null; state.syntheticReport = null; state.report = null;
  state.approved = false; state.cloudApproved = false; state.view = 'main';
}
function resetSource() {
  invalidate(); aiRevision++;
  state.source = null; state.original = null; state.filename = ''; state.condition = '';
  state.candidates = []; state.aiStatus = 'idle'; state.inferenceSource = null; state.progress = null;
}
function approvedBundle() {
  if (state.view !== 'review' || !state.report) throw new Error('HANDOFF_NOT_APPROVED');
  return createShareBundle({ originalReport: state.original, synthetic: state.synthetic, approved: state.approved, report: state.report });
}
let dialogFocus;
function openSettings() {
  const dialog = document.getElementById('settings-dialog');
  dialog.innerHTML = `<div class="dialog-head"><h2 id="settings-title">${t('settings')}</h2>${btn('close-settings', 'close')}</div><div class="dialog-content"><h3>${t('configuration')}</h3><span class="badge">${config.demo ? 'Demo mode' : t('configured')}</span><p>${config.demo ? t('demoSettings') : t('configured')}</p><p>${t('configHelp')}</p><h3>${t('auth')}</h3><p>${t('authHelp')}</p>${state.signedIn ? `<p>${t(config.demo ? 'demoSignIn' : 'signedIn')}</p>${btn('sign-out', 'signOut')}` : btn('sign-in', 'signIn')}
  <h3>${t('agents')}</h3><p>${t('agentsIntro')}</p><dl class="details">${[['prepare_repro', 'prepareTool'], ['get_repro', 'reproTool'], ['get_validation_report', 'validationTool']].map(([name, key]) => `<div><dt><code>${name}</code></dt><dd>${t(key)}</dd></div>`).join('')}</dl><p class="privacy-card">${t('agentPrivacy')}</p><h3>${t('scope')}</h3><p>${t('scopeText')}</p></div>`;
  if (!dialog.open) { dialogFocus = document.activeElement; dialog.showModal(); }
}
function showPreview() {
  const bundle = approvedBundle();
  const dialog = document.getElementById('bundle-dialog');
  dialog.innerHTML = `<div class="dialog-head"><h2 id="bundle-title">${t('bundlePreview')}</h2>${btn('close-bundle', 'close')}</div><div class="dialog-content"><p>${t('exportHelp')}</p><label class="field-label" for="bundle-json">JSON</label><textarea id="bundle-json" readonly spellcheck="false">${esc(JSON.stringify(bundle, null, 2))}</textarea></div>`;
  dialogFocus = document.activeElement; dialog.showModal();
}
export async function action(name) {
  if (name === 'settings') { openSettings(); return; }
  if (name === 'close-settings' || name === 'close-bundle') { document.getElementById(name === 'close-settings' ? 'settings-dialog' : 'bundle-dialog').close(); return; }
  if (name === 'en' || name === 'ja') { state.lang = name; refresh(); return; }
  if (busy()) return;
  if (name === 'sample') {
    fileRevision++; resetSource(); state.source = C.makeSample(); state.filename = 'fictional-demo.csv'; state.original = C.validate(state.source); state.notice = 'loaded';
  } else if (name === 'manual') {
    aiRevision++; state.aiStatus = 'manual'; state.candidates = []; state.inferenceSource = null; state.notice = 'manualNote';
  } else if (name === 'analyze') {
    if (!state.source || ['preparing', 'analyzing'].includes(state.aiStatus)) return;
    const token = ++aiRevision;
    state.aiStatus = firstLocalCall ? 'preparing' : 'analyzing'; state.progress = null; refresh();
    const summary = localSummary(state.source, state.original);
    let outcome;
    try {
      const { inferCandidates } = await import('./ai.js');
      outcome = await candidateOutcome((feature, input) => inferCandidates(input, progress => {
        if (token === aiRevision) { state.progress = Math.round(progress * 100); render(); }
      }), summary);
    } catch { outcome = { status: 'manual', candidates: [], inferenceSource: null }; }
    if (token !== aiRevision) return;
    firstLocalCall = outcome.status !== 'ready';
    state.aiStatus = outcome.status; state.candidates = outcome.candidates; state.inferenceSource = outcome.inferenceSource;
    if (outcome.status === 'ready') { invalidate(); state.condition = outcome.candidates[0].condition; }
    state.notice = outcome.status === 'ready' ? 'ready' : 'unavailable';
  } else if (name === 'generate') {
    if (!state.source || !state.condition) return;
    aiRevision++; if (['preparing', 'analyzing'].includes(state.aiStatus)) state.aiStatus = 'manual';
    invalidate(); state.synthetic = C.generateSynthetic(state.source, state.condition); state.original = C.validate(state.source); state.syntheticReport = C.validate(state.synthetic.data); state.notice = matched() ? 'sameFailure' : 'mismatchDetail';
  } else if (name === 'rerun') {
    if (!state.source || !state.synthetic) return;
    state.original = C.validate(state.source); state.syntheticReport = C.validate(state.synthetic.data); state.approved = false; state.cloudApproved = false; state.report = null; state.notice = matched() ? 'sameFailure' : 'mismatchDetail';
  } else if (name === 'review') {
    if (!matched()) return;
    state.view = 'review'; state.approved = false; state.cloudApproved = false; state.notice = '';
    if (config.demo) state.report = demoReport(state.synthetic, state.lang);
  } else if (name === 'back') {
    state.view = 'main'; state.approved = false; state.cloudApproved = false; state.notice = '';
  } else if (name === 'draft' || name === 'rewrite') {
    if (!matched() || state.view !== 'review' || (name === 'draft' && !state.cloudApproved) || (name === 'rewrite' && !state.report)) return;
    const token = revision;
    state.work = name === 'draft' ? 'cloudBusy' : 'rewriteBusy'; state.approved = false; refresh();
    try {
      const { draftReport, rewriteReport } = await import('./ai.js');
      const report = name === 'draft' ? await draftReport(state.synthetic, state.lang) : await rewriteReport(state.report, state.lang);
      if (token === revision) { state.report = report; state.notice = 'draftChanged'; }
    } catch { state.notice = 'cloudError'; }
    finally { state.work = ''; }
  } else if (name === 'preview') { if (!state.approved || !matched()) return; showPreview(); return;
  } else if (name === 'export') {
    if (!state.approved || !matched()) return;
    const bundle = approvedBundle();
    const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'casetwin-share-bundle.json'; document.body.append(anchor); anchor.click(); anchor.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); state.notice = 'exported';
  } else if (name === 'save') {
    if (!state.approved || !matched() || (!config.demo && !state.signedIn)) return;
    const bundle = approvedBundle(); state.work = 'save'; refresh();
    try { const { saveBundle } = await import('./firebase.js'); const result = await saveBundle(bundle); state.notice = result.simulated ? 'demoSaved' : 'saved'; }
    catch { state.notice = 'cloudError'; } finally { state.work = ''; }
  } else if (name === 'sign-in' || name === 'sign-out') {
    state.work = name === 'sign-in' ? 'signIn' : 'signOut'; refresh();
    try {
      const auth = await import('./firebase.js');
      if (name === 'sign-in') { const result = await auth.signIn(); state.signedIn = result.demo || result.signedIn; state.notice = result.demo ? 'demoSignIn' : 'signedIn'; }
      else { await auth.signOut(); state.signedIn = false; state.notice = 'signedOut'; }
    } catch { state.notice = 'cloudError'; }
    finally { state.work = ''; if (document.getElementById('settings-dialog').open) openSettings(); }
  }
  refresh();
  if (name === 'review' || name === 'back') { document.querySelector('h1')?.focus(); }
}
export async function loadFile(file) {
  if (!file || busy()) return;
  const token = ++fileRevision;
  resetSource(); state.work = 'reading'; refresh();
  if (file.size > 2 * 1024 * 1024) { state.work = ''; state.notice = 'tooLarge'; refresh(); return; }
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (token !== fileRevision) return;
    state.source = C.readBytes(bytes); state.filename = file.name; state.original = C.validate(state.source); state.notice = 'loaded';
  } catch { if (token !== fileRevision) return; state.notice = 'readError'; }
  state.work = ''; refresh();
}
document.addEventListener('click', event => {
  const target = event.target.closest('[data-action]');
  if (!target || target.disabled) return;
  const name = target.dataset.action;
  action(name).then(() => {
    if (!['settings', 'preview', 'close-settings', 'close-bundle', 'review', 'back'].includes(name)) document.querySelector(`[data-action="${name}"]`)?.focus();
  }).catch(() => { state.notice = 'cloudError'; state.work = ''; refresh(); });
});
document.addEventListener('change', event => {
  if (event.target.id === 'csv-file') { void loadFile(event.target.files[0]); }
  else if (event.target.id === 'condition') {
    aiRevision++; if (['preparing', 'analyzing'].includes(state.aiStatus)) state.aiStatus = 'manual';
    state.condition = event.target.value; invalidate(); state.notice = 'changed'; refresh(); document.getElementById('condition')?.focus();
  } else if (event.target.id === 'approval') {
    state.approved = event.target.checked && matched() && Boolean(state.report); render(); document.getElementById('approval')?.focus();
  } else if (event.target.id === 'cloud-approval') {
    state.cloudApproved = event.target.checked; render(); document.getElementById('cloud-approval')?.focus();
  }
});
for (const id of ['settings-dialog', 'bundle-dialog']) document.getElementById(id).addEventListener('close', () => {
  const action = dialogFocus?.dataset?.action;
  (action ? document.querySelector(`[data-action="${action}"]`) : dialogFocus)?.focus();
});
render();
