import { api } from '../assets/js/api.js';
import { $, esc, flashNext, money, param, titleCase } from '../assets/js/ui.js';
import { flash, mountLayout } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('pos', 'Purchase Orders — ProcureOS');
const statusFilter = param('status') || '';
const search = (param('search') || '').trim();

const STATUS_TABS = [
  ['', 'All'], ['open', 'Open'], ['partially_received', 'Partially Received'],
  ['closed', 'Closed'], ['cancelled', 'Cancelled'],
];

function listUrl({ status = statusFilter, q = search } = {}) {
  const p = new URLSearchParams();
  if (status) p.set('status', status);
  if (q) p.set('search', q);
  const s = p.toString();
  return url(`procureos/${s ? `?${s}` : ''}`);
}

async function loadAll() {
  const all = [];
  for (let page = 1; ; page++) {
    const qs = new URLSearchParams({ page, limit: 200 });
    if (statusFilter) qs.set('status', statusFilter);
    const { purchase_orders } = await api('procureos', `/api/pos?${qs}`);
    all.push(...purchase_orders);
    if (purchase_orders.length < 200) return all;
  }
}

function render(pos) {
  const needle = search.toLowerCase();
  const rows = needle
    ? pos.filter((p) => p.po_number.toLowerCase().includes(needle) || (p.vendor_name || '').toLowerCase().includes(needle))
    : pos;

  const table = rows.length ? `
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr>
          <th>PO Number</th><th>Vendor</th><th>Issue Date</th><th>Delivery Date</th>
          <th class="text-right">Total</th><th>Status</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map((po) => `
          <tr>
            <td><a href="${url(`procureos/po.html?n=${encodeURIComponent(po.po_number)}`)}" class="link-primary">${esc(po.po_number)}</a></td>
            <td>
              <div class="vendor-name">${esc(po.vendor_name || '—')}</div>
              ${po.vendor_id ? `<div class="text-muted text-sm">${esc(po.vendor_id)}</div>` : ''}
            </td>
            <td>${esc(po.issue_date || '—')}</td>
            <td>${esc(po.delivery_date || '—')}</td>
            <td class="text-right font-mono">${esc(po.currency || 'USD')} ${money(po.total_amount)}</td>
            <td><span class="badge badge-${esc(po.status)}">${esc(titleCase(po.status))}</span></td>
            <td class="actions-cell">
              <a href="${url(`procureos/po.html?n=${encodeURIComponent(po.po_number)}`)}" class="btn btn-ghost btn-xs">View</a>
              <a href="${url(`procureos/form.html?n=${encodeURIComponent(po.po_number)}`)}" class="btn btn-ghost btn-xs">Edit</a>
              <button type="button" class="btn btn-danger btn-xs" data-delete="${esc(po.po_number)}">Delete</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : `
    <div class="empty-state">
      <p class="empty-message">${search ? `No purchase orders match "${esc(search)}".` : 'No purchase orders yet.'}</p>
      <a href="${url(`procureos/form.html`)}" class="btn btn-primary">Create your first PO</a>
    </div>`;

  view.innerHTML = `
    <div class="page-header">
      <h1 class="page-title">Purchase Orders</h1>
      <a href="${url(`procureos/form.html`)}" class="btn btn-primary">+ New PO</a>
    </div>
    <div class="toolbar">
      <form class="search-form" id="search-form">
        <input type="search" id="search" value="${esc(search)}" placeholder="Search by PO number or vendor..." class="search-input" autocomplete="off" />
        <button type="submit" class="btn btn-secondary">Search</button>
        ${search ? `<a href="${listUrl({ q: '' })}" class="btn btn-ghost">Clear</a>` : ''}
      </form>
    </div>
    <div class="status-tabs">
      ${STATUS_TABS.map(([value, label]) => `
        <a href="${listUrl({ status: value })}" class="status-tab ${statusFilter === value ? 'active' : ''}">${label}</a>`).join('')}
    </div>
    ${table}
    <div id="delete-modal" class="modal-overlay" style="display:none;" role="dialog" aria-modal="true">
      <div class="modal">
        <h2 class="modal-title">Delete Purchase Order</h2>
        <p class="modal-body">Are you sure you want to delete <strong id="delete-modal-po-number"></strong>? This action cannot be undone.</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" id="delete-cancel">Cancel</button>
          <button type="button" class="btn btn-danger" id="delete-confirm">Delete</button>
        </div>
      </div>
    </div>`;

  $('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    location.href = listUrl({ q: $('#search').value.trim() });
  });
  wireDeleteModal();
}

function wireDeleteModal() {
  const modal = $('#delete-modal');
  let target = null;
  const close = () => { modal.style.display = 'none'; target = null; };

  view.querySelectorAll('[data-delete]').forEach((btn) => btn.addEventListener('click', () => {
    target = btn.dataset.delete;
    $('#delete-modal-po-number').textContent = target;
    modal.style.display = 'flex';
  }));
  $('#delete-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#delete-confirm').addEventListener('click', async () => {
    const number = target;
    close();
    try {
      await api('procureos', `/api/pos/${encodeURIComponent(number)}`, { method: 'DELETE' });
      flashNext(`Purchase Order ${number} deleted.`, 'success');
      location.reload();
    } catch (e) {
      flash(`Error deleting PO: ${e.message}`, 'error');
    }
  });
}

try {
  render(await loadAll());
} catch (e) {
  flash(`Error loading purchase orders: ${e.message}`, 'error');
}
