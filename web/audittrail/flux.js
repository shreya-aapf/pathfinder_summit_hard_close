import { api } from '../assets/js/api.js';
import { esc } from '../assets/js/ui.js';
import { ICON_PATHS, emptyState, flash, mountLayout, refTag, svg } from './layout.js';

const view = mountLayout('flux', 'Flux Analysis');

const dollars = (n) => (n === null || n === undefined ? '—' : `$${Number(n).toFixed(2)}`);

function variance(value) {
  if (value === null || value === undefined) return '—';
  const v = parseFloat(value);
  return `<span class="variance-pct ${Math.abs(v) > 10 ? 'variance-pct--high' : 'variance-pct--low'}">${v.toFixed(2)}%</span>`;
}

let rows = [];
try {
  rows = await api('audittrail', '/api/flux-analysis');
} catch (e) {
  flash(`Error loading flux analysis: ${e.message}`, 'error');
}

const alertIcon = svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', 12, 2.5);

const table = rows.length ? `
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr>
          <th>Category</th><th>Subsidiary</th><th>Period</th><th>Actual</th><th>Prior Quarter</th><th>Budget</th>
          <th>Var. vs Prior</th><th>Var. vs Budget</th><th>Explanation</th><th>Linked Reference</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((row) => `
        <tr class="${row.status === 'unexplained' ? 'row--escalated' : ''}">
          <td>${esc(row.category)}</td>
          <td>${esc(row.subsidiary || '—')}</td>
          <td class="cell-mono">${esc(row.period)}</td>
          <td class="cell-amount">${esc(dollars(row.actual))}</td>
          <td class="cell-amount">${esc(dollars(row.prior_quarter))}</td>
          <td class="cell-amount">${esc(dollars(row.budget))}</td>
          <td>${variance(row.variance_vs_prior_pct)}</td>
          <td>${variance(row.variance_vs_budget_pct)}</td>
          <td>${row.explanation
            ? `<span class="explanation-text">${esc(row.explanation)}</span>`
            : `<span class="unexplained-flag">${alertIcon} Unexplained</span>`}</td>
          <td class="cell-mono">${row.linked_reference ? refTag(row.linked_reference) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : emptyState(ICON_PATHS.flux, 'No flux analysis rows found', 'No variance analysis has been recorded yet.');

view.innerHTML = `
  <div class="page-header">
    <div>
      <h1 class="page-title">Flux Analysis</h1>
      <p class="page-subtitle">Actuals vs. prior quarter and budget, by category and subsidiary</p>
    </div>
  </div>
  ${table}`;
