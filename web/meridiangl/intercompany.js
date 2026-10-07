import { api } from '../assets/js/api.js';
import { esc, param } from '../assets/js/ui.js';
import { empty, flash, fmt, icon, mountLayout, subsidiaryParam, tabs } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('intercompany', 'Intercompany');
const subFilter = subsidiaryParam(param('subsidiary')) || 'all';
const rawFlag = (param('flag_type') || '').trim();
const flagFilter = ['matched', 'timing_difference', 'error'].includes(rawFlag) ? rawFlag : 'all';

const SUB_TABS = [['all', 'All'], ['A', 'Sub A'], ['B', 'Sub B'], ['C', 'Sub C']];
const FLAG_TABS = [['all', 'All Flags'], ['matched', 'Matched'], ['timing_difference', 'Timing Difference'], ['error', 'Error']];

function flagBadge(type) {
  if (type === 'matched') return '<span class="badge badge--green">Matched</span>';
  if (type === 'timing_difference') return '<span class="badge badge--amber">Timing Difference</span>';
  if (type === 'error') return '<span class="badge badge--red">Error</span>';
  return `<span class="badge badge--gray">${esc(type)}</span>`;
}

function row(e) {
  const cls = e.flag_type === 'error' ? 'row--variance' : e.flag_type === 'flagged' ? 'row--flagged' : '';
  return `
      <tr class="${cls}">
        <td class="cell-mono">${esc(e.transaction_ref)}</td>
        <td><span class="sub-chip">${esc(e.subsidiary_from)}</span></td>
        <td><span class="sub-chip">${esc(e.subsidiary_to)}</span></td>
        <td class="cell-amount">${fmt(e.amount)}</td>
        <td>${esc(e.description || '—')}</td>
        <td class="cell-date">${esc(e.posted_date_from)}</td>
        <td class="cell-date">${esc(e.posted_date_to || '—')}</td>
        <td>${flagBadge(e.flag_type)}</td>
        <td class="text-muted">${esc(e.note || '—')}</td>
      </tr>`;
}

function render(entries) {
  const body = entries.length ? `
<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th>Transaction Ref</th><th>From</th><th>To</th><th>Amount</th><th>Description</th>
        <th>Posted (From)</th><th>Posted (To)</th><th>Flag</th><th>Note</th>
      </tr>
    </thead>
    <tbody>${entries.map(row).join('')}</tbody>
  </table>
</div>` : empty('intercompany', 'No intercompany entries found', 'No transactions match the current filters.');

  view.innerHTML = `
<div class="page-header">
  <div>
    <h1 class="page-title">Intercompany Log</h1>
    <p class="page-subtitle">Cross-subsidiary transactions and their reconciliation flags</p>
  </div>
</div>
<div class="info-note">
  ${icon('info', 15)}
  <span><code>timing_difference</code> means the same amount was posted by both subsidiaries, just in different periods — informational, not a booking error. <code>error</code> flags need investigation.</span>
</div>
${tabs(SUB_TABS, subFilter, (v) => url(`meridiangl/intercompany.html?subsidiary=${v}&flag_type=${flagFilter}`))}
${tabs(FLAG_TABS, flagFilter, (v) => url(`meridiangl/intercompany.html?subsidiary=${subFilter}&flag_type=${v}`))}
${body}`;
}

try {
  const qs = new URLSearchParams();
  if (subFilter !== 'all') qs.set('subsidiary', subFilter);
  if (flagFilter !== 'all') qs.set('flag_type', flagFilter);
  const s = qs.toString();
  render(await api('meridiangl', `/api/gl/intercompany${s ? `?${s}` : ''}`));
} catch (e) {
  flash(`Error loading intercompany log: ${e.message}`);
  render([]);
}
