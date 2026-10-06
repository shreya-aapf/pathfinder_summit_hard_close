import { api } from '/assets/js/api.js';
import { esc } from '/assets/js/ui.js';
import { ICON_PATHS, emptyState, flash, mountLayout } from './layout.js';

const view = mountLayout('flags', 'Vendor Flags');

const flagTypeBadge = (t) => t === 'bank_mismatch' ? '<span class="badge badge--urgent">Bank Mismatch</span>'
  : t === 'duplicate_vendor' ? '<span class="badge badge--amber">Duplicate Vendor</span>'
  : `<span class="badge badge--gray">${esc(t)}</span>`;

const severityBadge = (s) => s === 'high' ? '<span class="badge badge--red">High</span>'
  : s === 'medium' ? '<span class="badge badge--amber">Medium</span>'
  : '<span class="badge badge--gray">Low</span>';

const statusBadge = (s) => s === 'open' ? '<span class="badge badge--urgent">Open</span>'
  : s === 'escalated' ? '<span class="badge badge--escalated">Escalated</span>'
  : s === 'cleared' ? '<span class="badge badge--green">Cleared</span>'
  : `<span class="badge badge--gray">${esc(s)}</span>`;

const detailUrl = (id) => `/audittrail/vendor-flag.html?id=${encodeURIComponent(id)}`;

let flags = [];
try {
  flags = await api('audittrail', '/api/vendor-flags');
} catch (e) {
  flash(`Error loading vendor flags: ${e.message}`, 'error');
}

const table = flags.length ? `
  <div class="table-wrap">
    <table class="data-table">
      <thead>
        <tr><th>Vendor</th><th>Invoice #</th><th>Flag Type</th><th>Severity</th><th>Status</th><th>Flagged</th></tr>
      </thead>
      <tbody>
        ${flags.map((f) => `
        <tr class="table-row-link ${f.status === 'escalated' ? 'row--escalated' : ''}" data-href="${esc(detailUrl(f.id))}">
          <td>
            <div class="vendor-name"><a href="${esc(detailUrl(f.id))}" class="link-plain">${esc(f.vendor_name)}</a></div>
            <div class="vendor-id">${esc(f.vendor_id)}</div>
          </td>
          <td class="cell-mono">${esc(f.invoice_number || '—')}</td>
          <td>${flagTypeBadge(f.flag_type)}</td>
          <td>${severityBadge(f.severity)}</td>
          <td>${statusBadge(f.status)}</td>
          <td class="cell-date">${f.created_at ? esc(String(f.created_at).slice(0, 10)) : '—'}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>` : emptyState(ICON_PATHS.flags, 'No vendor flags found', 'No vendors have been flagged by the automation yet.');

view.innerHTML = `
  <div class="page-header">
    <div>
      <h1 class="page-title">Vendor Flags</h1>
      <p class="page-subtitle">Vendors flagged for bank-detail mismatches, duplicates, or other risk signals</p>
    </div>
  </div>
  ${table}`;

view.addEventListener('click', (e) => {
  if (e.target.closest('a')) return;
  const row = e.target.closest('tr[data-href]');
  if (row) location.href = row.dataset.href;
});
