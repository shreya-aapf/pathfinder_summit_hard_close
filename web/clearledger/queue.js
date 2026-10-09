import { api } from '../assets/js/api.js';
import { esc, formatMoney, param } from '../assets/js/ui.js';
import { flash, mountLayout } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('queue', 'Invoice Queue');

const statusFilter = (param('status') || '').trim() || 'all';
const poFilter = (param('po_number') || '').trim();
const vendorFilter = (param('vendor_id') || '').trim();

const STATUS_BADGE = { pending: 'amber', approved: 'green', escalated: 'purple', contacted: 'blue' };
const STATUS_LABEL = { pending: 'Pending', approved: 'Approved', escalated: 'Escalated', contacted: 'Contacted' };
const MATCH_BADGE = { mismatch: ['red', 'Mismatch'], partial_match: ['amber', 'Partial Match'] };

function queueUrl(status) {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (poFilter) p.set('po_number', poFilter);
  if (vendorFilter) p.set('vendor_id', vendorFilter);
  return url(`clearledger/?${p}`);
}

async function loadAll() {
  const all = [];
  for (let page = 1; ; page++) {
    const rows = await api('clearledger', `/api/invoices?page=${page}&limit=200`);
    all.push(...rows);
    if (rows.length < 200) return all;
  }
}

function render(all) {
  const counts = { pending: 0, approved: 0, escalated: 0, contacted: 0 };
  for (const row of all) if (row.status in counts) counts[row.status]++;
  counts.all = counts.pending + counts.approved + counts.escalated + counts.contacted;

  const invoices = all.filter((inv) =>
    (statusFilter === 'all' || inv.status === statusFilter)
    && (!poFilter || inv.po_number === poFilter)
    && (!vendorFilter || inv.vendor_id === vendorFilter));

  const tabs = [['all', 'All'], ['pending', 'Pending'], ['approved', 'Approved'], ['escalated', 'Escalated'], ['contacted', 'Contacted']];

  const filterBar = poFilter || vendorFilter ? `
    <div class="flash flash--success" style="display:flex; align-items:center; justify-content:space-between; gap:12px;">
      <span>
        ${poFilter ? `Filtered by PO <strong>${esc(poFilter)}</strong>` : ''}
        ${poFilter && vendorFilter ? ' &middot; ' : ''}
        ${vendorFilter ? `Filtered by vendor <strong>${esc(vendorFilter)}</strong>` : ''}
        — linked from another system.
      </span>
      <a href="${url(`clearledger/?status=${encodeURIComponent(statusFilter)}`)}" class="link-plain">Clear filter</a>
    </div>` : '';

  const rows = invoices.map((inv) => {
    const href = url(`clearledger/invoice.html?id=${encodeURIComponent(inv.id)}`);
    const vp = parseFloat(inv.variance_pct) || 0;
    const [mClass, mLabel] = MATCH_BADGE[inv.match_status] || ['gray', inv.match_status ?? ''];
    const sClass = STATUS_BADGE[inv.status] || 'gray';
    const sLabel = STATUS_LABEL[inv.status] || inv.status;
    return `
      <tr class="table-row-link" data-href="${esc(href)}">
        <td class="cell-mono"><a href="${esc(href)}" class="link-plain">${esc(inv.invoice_number)}</a></td>
        <td>
          <div class="vendor-name">${esc(inv.vendor_name)}</div>
          <div class="vendor-id">${esc(inv.vendor_id)}</div>
        </td>
        <td class="cell-mono">${esc(inv.po_number)}</td>
        <td class="cell-amount">${esc(formatMoney(inv.total_amount, inv.currency))}</td>
        <td><span class="variance-pct ${vp > 2.5 ? 'variance-pct--high' : 'variance-pct--low'}">${vp.toFixed(2)}%</span></td>
        <td><span class="badge badge--${mClass}">${esc(mLabel)}</span></td>
        <td><span class="badge badge--${sClass}">${esc(sLabel)}</span></td>
        <td class="cell-date">${esc(inv.created_at ? inv.created_at.slice(0, 10) : '—')}</td>
      </tr>`;
  }).join('');

  const body = invoices.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>Invoice #</th><th>Vendor</th><th>PO Number</th><th>Amount</th>
          <th>Variance %</th><th>Mismatch</th><th>Status</th><th>Received</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <div class="empty-state-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
          <rect x="9" y="3" width="6" height="4" rx="1" ry="1"/>
        </svg>
      </div>
      <p class="empty-state-title">No invoices found</p>
      <p class="empty-state-sub">${statusFilter !== 'all'
        ? `No invoices with status "${esc(statusFilter)}". <a href="${url(`clearledger/`)}">View all invoices</a>`
        : "The automation hasn't posted any invoices yet."}</p>
    </div>`;

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Invoice Queue</h1>
        <p class="page-subtitle">Flagged invoices awaiting review from the matching workflow</p>
      </div>
    </div>
    ${filterBar}
    <div class="filter-tabs">
      ${tabs.map(([value, label]) => `
        <a href="${esc(queueUrl(value))}" class="filter-tab ${statusFilter === value ? 'filter-tab--active' : ''}">
          ${label}
          <span class="tab-count tab-count--${value}">${counts[value]}</span>
        </a>`).join('')}
    </div>
    ${body}`;

  view.querySelectorAll('tr[data-href]').forEach((tr) => tr.addEventListener('click', (e) => {
    if (!e.target.closest('a')) location.href = tr.dataset.href;
  }));
}

try {
  render(await loadAll());
} catch (e) {
  flash(`Error loading invoices: ${e.message}`, 'error');
}
