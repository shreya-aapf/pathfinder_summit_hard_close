import { api } from '../assets/js/api.js';
import { esc, param } from '../assets/js/ui.js';
import { DELETE_MODAL, capitalize, mountLayout } from './layout.js';
import { wireDeleteModal } from './delete-modal.js';
import { url } from '../assets/js/site.js';

const number = param('n');
const view = mountLayout('receipts', `${number || 'Receipt'} — ReceiptsLog`);

const price = (v) => (v ? Number(v).toFixed(2) : '—');

function lineRow(li) {
  const ordered = Number(li.quantity_ordered) || 0;
  const received = Number(li.quantity_received) || 0;
  const variance = ordered - received;
  let rowClass = '';
  if (li.condition === 'damaged' || li.condition === 'rejected') rowClass = 'row-danger';
  else if (variance > 0) rowClass = 'row-warning';

  let varianceCell = '<span class="variance-zero">—</span>';
  if (variance > 0) varianceCell = `<span class="variance-neg">−${esc(variance)}</span>`;
  else if (variance < 0) varianceCell = `<span class="variance-pos">+${esc(Math.abs(variance))}</span>`;

  return `
    <tr class="${rowClass}">
      <td>${esc(li.line_number)}</td>
      <td class="mono">${esc(li.item_code)}</td>
      <td>${esc(li.description)}</td>
      <td class="num">${esc(li.quantity_ordered)}</td>
      <td class="num">
        ${esc(li.quantity_received)}
        ${variance > 0 ? '<span class="variance-dot" title="Short delivery"></span>' : ''}
      </td>
      <td class="num">${varianceCell}</td>
      <td class="num">${price(li.unit_price)}</td>
      <td><span class="condition-badge condition-${esc(li.condition)}">${esc(capitalize(li.condition))}</span></td>
    </tr>`;
}

function render(gr) {
  const n = encodeURIComponent(gr.gr_number);
  const po = encodeURIComponent(gr.po_number);
  const lines = gr.line_items || [];
  document.title = `${gr.gr_number} — ReceiptsLog`;

  view.innerHTML = `
    <div class="breadcrumb"><a href="${url(`receiptslog/`)}" class="breadcrumb-link">← All Receipts</a></div>

    <div class="detail-header">
      <div class="detail-header-left">
        <h1 class="detail-gr-number">${esc(gr.gr_number)}</h1>
        <div class="detail-po-row">
          <span class="detail-po-label">PO</span>
          <span class="detail-po-number">${esc(gr.po_number)}</span>
        </div>
      </div>
      <div class="detail-header-right">
        <span class="badge badge-${esc(gr.status)} badge-lg">${esc(capitalize(gr.status))}</span>
        <div class="detail-actions">
          <a href="${url(`procureos/po.html?n=${po}`)}" target="_blank" rel="noopener" class="btn btn-secondary">View PO in ProcureOS ↗</a>
          <a href="${url(`clearledger/?po_number=${po}`)}" target="_blank" rel="noopener" class="btn btn-secondary">View invoices in ClearLedger ↗</a>
          <a href="${url(`receiptslog/form.html?n=${n}`)}" class="btn btn-secondary">Edit</a>
          <button type="button" class="btn btn-danger" data-delete="${esc(gr.gr_number)}">Delete</button>
        </div>
      </div>
    </div>

    <div class="detail-meta-grid">
      <div class="meta-card">
        <span class="meta-label">Vendor</span>
        <span class="meta-value">${esc(gr.vendor_name)}</span>
        <span class="meta-sub">${esc(gr.vendor_id)}</span>
      </div>
      <div class="meta-card"><span class="meta-label">Received Date</span><span class="meta-value">${esc(gr.received_date)}</span></div>
      <div class="meta-card"><span class="meta-label">Received By</span><span class="meta-value">${esc(gr.received_by)}</span></div>
      <div class="meta-card"><span class="meta-label">Line Items</span><span class="meta-value">${lines.length}</span></div>
    </div>

    <section class="section">
      <h2 class="section-title">Line Items</h2>
      ${lines.length ? `
      <div class="table-wrap">
        <table class="data-table line-items-table">
          <thead><tr>
            <th>#</th><th>Item Code</th><th>Description</th>
            <th class="num">Ordered Qty</th><th class="num">Received Qty</th><th class="num">Variance</th>
            <th class="num">Unit Price</th><th>Condition</th>
          </tr></thead>
          <tbody>${lines.map(lineRow).join('')}</tbody>
        </table>
      </div>` : '<p class="empty-inline">No line items recorded.</p>'}
    </section>
    ${DELETE_MODAL}`;
  wireDeleteModal();
}

if (!number) {
  location.replace(url('receiptslog/'));
} else {
  try {
    render(await api('receiptslog', `/api/gr/${encodeURIComponent(number)}`));
  } catch (e) {
    view.innerHTML = `
      <div class="breadcrumb"><a href="${url(`receiptslog/`)}" class="breadcrumb-link">← All Receipts</a></div>
      <h1 class="page-title">Not found</h1>
      <div class="empty-state"><p>${e.status === 404 ? `Receipt ${esc(number)} was not found.` : esc(e.message)}</p></div>`;
  }
}
