import { api } from '../assets/js/api.js';
import { esc, param } from '../assets/js/ui.js';
import { empty, flash, fmt, mountLayout, subsidiaryParam, tabs } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('balance', 'Balance Sheet');
const filter = subsidiaryParam(param('subsidiary')) || 'all';

const TABS = [['all', 'All'], ['A', 'Subsidiary A'], ['B', 'Subsidiary B'], ['C', 'Subsidiary C']];

function row({ account: acc, balance: bal }) {
  const variance = bal && bal.status === 'variance';
  let varianceCell = '—';
  if (variance) varianceCell = `<span class="num-unfavorable">${fmt(bal.variance_amount)}</span>`;
  else if (bal) varianceCell = '<span class="num-favorable">0.00</span>';
  const ref = variance && bal.source_doc_ref ? esc(bal.source_doc_ref) : '—';
  return `
      <tr class="${variance ? 'row--variance' : ''}">
        <td><span class="sub-chip">${esc(acc.subsidiary)}</span></td>
        <td class="cell-mono">${esc(acc.account_code)}</td>
        <td><div class="account-name">${esc(acc.account_name)}</div></td>
        <td><span class="badge badge--gray">${esc(acc.account_type)}</span></td>
        <td class="cell-mono">${bal ? esc(bal.period) : '—'}</td>
        <td class="cell-amount">${bal ? fmt(bal.gl_balance) : '—'}</td>
        <td class="cell-amount">${bal && bal.subledger_balance !== null && bal.subledger_balance !== undefined ? fmt(bal.subledger_balance) : '—'}</td>
        <td class="cell-amount">${varianceCell}</td>
        <td class="cell-mono">${ref}</td>
      </tr>`;
}

function render(rows) {
  const body = rows.length ? `
<div class="table-wrap">
  <table class="data-table">
    <thead>
      <tr>
        <th>Sub</th><th>Account Code</th><th>Account Name</th><th>Type</th><th>Period</th>
        <th>GL Balance</th><th>Subledger Balance</th><th>Variance</th><th>Source Doc Ref</th>
      </tr>
    </thead>
    <tbody>${rows.map(row).join('')}</tbody>
  </table>
</div>` : empty('balance', 'No GL accounts found', filter !== 'all'
    ? `No accounts for Subsidiary ${esc(filter)}. <a href="${url(`meridiangl/`)}" class="link-plain">View all subsidiaries</a>`
    : 'No accounts have been loaded into the ledger yet.');

  view.innerHTML = `
<div class="page-header">
  <div>
    <h1 class="page-title">Balance Sheet</h1>
    <p class="page-subtitle">GL account balances vs. sub-ledger, by subsidiary</p>
  </div>
</div>
${tabs(TABS, filter, (v) => url(`meridiangl/?subsidiary=${v}`))}
${body}`;
}

try {
  const data = await api('meridiangl', `/api/gl/balance-sheet${filter === 'all' ? '' : `?subsidiary=${filter}`}`);
  render(data.rows);
} catch (e) {
  flash(`Error loading accounts: ${e.message}`);
  render([]);
}
