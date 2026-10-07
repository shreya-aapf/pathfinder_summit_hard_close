import { api } from '../assets/js/api.js';
import { esc, param } from '../assets/js/ui.js';
import { empty, flash, fmt, mountLayout, subsidiaryParam, tabs } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('accruals', 'Accruals');
const subFilter = subsidiaryParam(param('subsidiary')) || 'all';
const periodFilter = (param('period') || '').trim();

const TABS = [['all', 'All'], ['A', 'Subsidiary A'], ['B', 'Subsidiary B'], ['C', 'Subsidiary C']];

function varianceCell(r) {
  if (r.variance_pct === null || r.variance_pct === undefined) return '—';
  const vp = Number(r.variance_pct);
  const cls = Math.abs(vp) > Number(r.tolerance_pct) ? 'num-unfavorable' : 'num-favorable';
  return `<span class="${cls}">${fmt(vp)}%</span>`;
}

function statusBadge(r) {
  if (r.blocked_by_open_ap) return '<span class="badge badge--red">Blocked</span>';
  if (r.status === 'flagged') return '<span class="badge badge--amber">Flagged</span>';
  if (r.status === 'within_tolerance') return '<span class="badge badge--green">Within Tolerance</span>';
  return `<span class="badge badge--gray">${esc(r.status)}</span>`;
}

function row(r) {
  const cls = r.blocked_by_open_ap ? 'row--blocked' : r.status === 'flagged' ? 'row--flagged' : 'row--within_tolerance';
  return `
      <tr class="${cls}">
        <td><span class="sub-chip">${esc(r.subsidiary)}</span></td>
        <td class="cell-mono">${esc(r.period)}</td>
        <td>${esc(r.description)}</td>
        <td class="cell-amount">${fmt(r.estimated_amount)}</td>
        <td class="cell-amount">${r.actual_amount !== null && r.actual_amount !== undefined ? fmt(r.actual_amount) : '—'}</td>
        <td class="cell-num">${varianceCell(r)}</td>
        <td class="cell-num">${fmt(r.tolerance_pct)}%</td>
        <td>${statusBadge(r)}</td>
        <td class="cell-mono">${r.blocked_by_open_ap && r.ap_reference ? esc(r.ap_reference) : '—'}</td>
      </tr>`;
}

function render(rows) {
  const body = rows.length ? `
<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th>Sub</th><th>Period</th><th>Description</th><th>Estimated</th><th>Actual</th>
        <th>Variance %</th><th>Tolerance %</th><th>Status</th><th>AP Reference</th>
      </tr>
    </thead>
    <tbody>${rows.map(row).join('')}</tbody>
  </table>
</div>` : empty('accruals', 'No accruals found', subFilter !== 'all'
    ? `No accruals for Subsidiary ${esc(subFilter)}. <a href="${url(`meridiangl/accruals.html`)}" class="link-plain">View all subsidiaries</a>`
    : 'No accruals have been recorded for this period yet.');

  view.innerHTML = `
<div class="page-header">
  <div>
    <h1 class="page-title">Accruals Schedule</h1>
    <p class="page-subtitle">Estimated vs. actual accruals, by subsidiary and period</p>
  </div>
</div>
${tabs(TABS, subFilter, (v) => url(`meridiangl/accruals.html?subsidiary=${v}${periodFilter ? `&period=${encodeURIComponent(periodFilter)}` : ''}`))}
${body}`;
}

try {
  const qs = new URLSearchParams();
  if (subFilter !== 'all') qs.set('subsidiary', subFilter);
  if (periodFilter) qs.set('period', periodFilter);
  const s = qs.toString();
  render(await api('meridiangl', `/api/gl/accruals${s ? `?${s}` : ''}`));
} catch (e) {
  flash(`Error loading accruals: ${e.message}`);
  render([]);
}
