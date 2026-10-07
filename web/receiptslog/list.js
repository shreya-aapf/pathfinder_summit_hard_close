import { api } from '/assets/js/api.js';
import { $, esc, param } from '/assets/js/ui.js';
import { DELETE_MODAL, capitalize, flash, mountLayout } from './layout.js';
import { wireDeleteModal } from './delete-modal.js';

const view = mountLayout('receipts', 'Goods Received — ReceiptsLog');
const STATUSES = ['partial', 'complete', 'rejected'];
const requested = param('status') || '';
const statusFilter = STATUSES.includes(requested) ? requested : '';
const search = (param('search') || '').trim();

function listUrl({ status = statusFilter, q = search } = {}) {
  const p = new URLSearchParams();
  if (q) p.set('search', q);
  if (status) p.set('status', status);
  const s = p.toString();
  return `/receiptslog/${s ? `?${s}` : ''}`;
}

async function loadAll() {
  const all = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ page, limit: 200 });
    if (statusFilter) qs.set('status', statusFilter);
    const { data } = await api('receiptslog', `/api/grs?${qs}`);
    all.push(...data);
    if (data.length < 200) return all;
  }
}

function render(all) {
  const needle = search.toLowerCase();
  const grs = needle
    ? all.filter((g) => [g.gr_number, g.po_number, g.vendor_name, g.vendor_id, g.received_by]
      .some((v) => String(v ?? '').toLowerCase().includes(needle)))
    : all;

  const table = grs.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>GR #</th><th>PO #</th><th>Vendor</th><th>Received Date</th><th>Received By</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>${grs.map((gr) => `
          <tr>
            <td><a href="/receiptslog/gr.html?n=${encodeURIComponent(gr.gr_number)}" class="gr-link">${esc(gr.gr_number)}</a></td>
            <td class="mono">${esc(gr.po_number)}</td>
            <td>
              <span class="vendor-name">${esc(gr.vendor_name)}</span>
              <span class="vendor-id">${esc(gr.vendor_id)}</span>
            </td>
            <td>${esc(gr.received_date)}</td>
            <td>${esc(gr.received_by)}</td>
            <td><span class="badge badge-${esc(gr.status)}">${esc(capitalize(gr.status))}</span></td>
            <td class="actions-cell">
              <a href="/receiptslog/form.html?n=${encodeURIComponent(gr.gr_number)}" class="action-link">Edit</a>
              <button type="button" class="action-link action-link-danger" data-delete="${esc(gr.gr_number)}">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <p>No goods received records found.</p>
      <a href="/receiptslog/form.html" class="btn btn-primary btn-sm">Record first receipt</a>
    </div>`;

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Goods Received</h1>
        <p class="page-subtitle">Warehouse receipt records — ${grs.length} record${grs.length !== 1 ? 's' : ''}${search ? ` matching "${esc(search)}"` : ''}</p>
      </div>
      <a href="/receiptslog/form.html" class="btn btn-primary">+ New Receipt</a>
    </div>
    <div class="toolbar">
      <form class="search-form" id="search-form">
        <input type="search" id="search" value="${esc(search)}" placeholder="Search GR #, PO #, vendor, received by…" class="search-input" />
        <button type="submit" class="btn btn-secondary btn-sm">Search</button>
        ${search ? `<a href="${listUrl({ q: '' })}" class="btn btn-ghost btn-sm">Clear</a>` : ''}
      </form>
      <div class="filter-tabs">
        <a href="${listUrl({ status: '' })}" class="filter-tab ${statusFilter ? '' : 'active'}">All</a>
        ${STATUSES.map((s) => `
        <a href="${listUrl({ status: s })}" class="filter-tab ${statusFilter === s ? 'active' : ''}"><span class="badge badge-${s}">${capitalize(s)}</span></a>`).join('')}
      </div>
    </div>
    ${table}
    ${DELETE_MODAL}`;

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    location.href = listUrl({ q: $('#search').value.trim() });
  });
  wireDeleteModal();
}

try {
  render(await loadAll());
} catch (e) {
  flash(`Error loading receipts: ${e.message}`, 'error');
}
