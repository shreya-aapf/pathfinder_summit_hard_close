import { api } from '../assets/js/api.js';
import { $, $$, esc, flashNext, param } from '../assets/js/ui.js';
import { flash, mountLayout } from './layout.js';
import { url } from '../assets/js/site.js';

const editing = param('n');
const view = mountLayout('receipts', `${editing ? `Edit ${editing}` : 'New Receipt'} — ReceiptsLog`);

const CONDITIONS = [['good', 'Good'], ['damaged', 'Damaged'], ['rejected', 'Rejected']];
const STATUSES = [['partial', 'Partial'], ['complete', 'Complete'], ['rejected', 'Rejected']];

const rowHtml = (n, li = {}) => `
  <tr class="line-item-row">
    <td class="line-num-cell">${n}</td>
    <td><input type="text" data-f="item_code" class="form-control form-control-sm" value="${esc(li.item_code ?? '')}" placeholder="ITEM-001" /></td>
    <td><input type="text" data-f="description" class="form-control form-control-sm" value="${esc(li.description ?? '')}" placeholder="Description" /></td>
    <td><input type="number" data-f="quantity_ordered" class="form-control form-control-sm num" min="0" step="any" value="${esc(li.quantity_ordered ?? '')}" placeholder="0" /></td>
    <td class="rcv-cell">
      <input type="number" data-f="quantity_received" class="form-control form-control-sm num" min="0" step="any" value="${esc(li.quantity_received ?? '')}" placeholder="0" />
      <span class="variance-warn" style="display:none;" title="Received less than ordered">!</span>
    </td>
    <td><input type="number" data-f="unit_price" class="form-control form-control-sm num" min="0" step="0.01" value="${esc(li.unit_price ?? '')}" placeholder="0.00" /></td>
    <td>
      <select data-f="condition" class="form-control form-control-sm">
        ${CONDITIONS.map(([v, l]) => `<option value="${v}" ${li.condition === v ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
    </td>
    <td><button type="button" class="btn-remove-line" title="Remove line">&times;</button></td>
  </tr>`;

function render(gr) {
  const lines = gr?.line_items?.length ? gr.line_items : [{}];
  const back = gr ? url(`receiptslog/gr.html?n=${encodeURIComponent(gr.gr_number)}`) : url('receiptslog/');
  const status = gr?.status || 'partial';
  // Create mode requires every header field the API requires; edit keeps them optional like PUT does.
  const star = gr ? '' : ' <span class="required">*</span>';
  const req = gr ? '' : 'required';

  view.innerHTML = `
    <div class="breadcrumb"><a href="${back}" class="breadcrumb-link">← ${gr ? esc(gr.gr_number) : 'All Receipts'}</a></div>
    <h1 class="page-title">${gr ? 'Edit Receipt' : 'New Receipt'}</h1>
    <form class="receipt-form" id="receiptForm" novalidate>
      <div class="form-section">
        <h2 class="form-section-title">Receipt Header</h2>
        <div class="form-grid">
          <div class="form-group">
            <label class="form-label" for="gr_number">GR Number <span class="required">*</span></label>
            <input type="text" id="gr_number" class="form-control" value="${esc(gr?.gr_number || '')}" ${gr ? 'disabled' : ''} placeholder="GR-2024-0001" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="po_number">PO Number <span class="required">*</span></label>
            <input type="text" id="po_number" class="form-control" value="${esc(gr?.po_number || '')}" placeholder="PO-2024-0001" required />
          </div>
          <div class="form-group">
            <label class="form-label" for="vendor_id">Vendor ID${star}</label>
            <input type="text" id="vendor_id" class="form-control" value="${esc(gr?.vendor_id || '')}" placeholder="VEND-001" ${req} />
          </div>
          <div class="form-group">
            <label class="form-label" for="vendor_name">Vendor Name${star}</label>
            <input type="text" id="vendor_name" class="form-control" value="${esc(gr?.vendor_name || '')}" placeholder="Acme Supplies Ltd" ${req} />
          </div>
          <div class="form-group">
            <label class="form-label" for="received_date">Received Date</label>
            <input type="date" id="received_date" class="form-control" value="${esc(gr?.received_date || '')}" />
          </div>
          <div class="form-group">
            <label class="form-label" for="received_by">Received By${star}</label>
            <input type="text" id="received_by" class="form-control" value="${esc(gr?.received_by || '')}" placeholder="J. Santos" ${req} />
          </div>
          <div class="form-group">
            <label class="form-label" for="status">Status</label>
            <select id="status" class="form-control">
              ${STATUSES.map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
        </div>
      </div>

      <div class="form-section">
        <div class="form-section-header">
          <h2 class="form-section-title">Line Items</h2>
          <button type="button" class="btn btn-secondary btn-sm" id="addLineBtn">+ Add Line</button>
        </div>
        <div class="table-wrap">
          <table class="data-table line-form-table" id="lineItemsTable">
            <thead><tr>
              <th>#</th><th>Item Code</th><th>Description</th><th class="num">Ordered Qty</th>
              <th class="num">Received Qty</th><th class="num">Unit Price</th><th>Condition</th><th></th>
            </tr></thead>
            <tbody id="lineItemsBody">${lines.map((li, i) => rowHtml(i + 1, li)).join('')}</tbody>
          </table>
        </div>
      </div>

      <div class="form-actions">
        <button type="submit" class="btn btn-primary" id="submit">${gr ? 'Save Changes' : 'Record Receipt'}</button>
        <a href="${back}" class="btn btn-ghost">Cancel</a>
      </div>
    </form>`;

  wireLines();
  $('#receiptForm').addEventListener('submit', (e) => { e.preventDefault(); submit(gr); });
}

function updateVariance(row) {
  const ordered = parseFloat($('[data-f="quantity_ordered"]', row).value) || 0;
  const receivedInput = $('[data-f="quantity_received"]', row);
  const received = parseFloat(receivedInput.value) || 0;
  const short = ordered > 0 && received < ordered;
  $('.variance-warn', row).style.display = short ? 'inline' : 'none';
  receivedInput.style.borderColor = short ? 'var(--amber)' : '';
}

function wireLines() {
  const body = $('#lineItemsBody');
  const rows = () => $$('.line-item-row', body);

  body.addEventListener('input', (e) => {
    if (e.target.matches('[data-f="quantity_ordered"], [data-f="quantity_received"]')) updateVariance(e.target.closest('.line-item-row'));
  });
  body.addEventListener('click', (e) => {
    const remove = e.target.closest('.btn-remove-line');
    if (!remove || rows().length <= 1) return; // keep at least one row
    remove.closest('.line-item-row').remove();
    rows().forEach((row, i) => { $('.line-num-cell', row).textContent = i + 1; });
  });
  $('#addLineBtn').addEventListener('click', () => {
    body.insertAdjacentHTML('beforeend', rowHtml(rows().length + 1));
  });
  rows().forEach(updateVariance);
}

function collectLines() {
  const lines = [];
  $$('.line-item-row').forEach((row) => {
    const get = (f) => $(`[data-f="${f}"]`, row).value.trim();
    if (!['item_code', 'description', 'quantity_ordered', 'quantity_received', 'unit_price'].some(get)) return;
    lines.push({
      line_number: lines.length + 1,
      item_code: get('item_code'),
      description: get('description'),
      quantity_ordered: parseFloat(get('quantity_ordered')) || 0,
      quantity_received: parseFloat(get('quantity_received')) || 0,
      unit_price: parseFloat(get('unit_price')) || 0,
      condition: $('[data-f="condition"]', row).value,
    });
  });
  return lines;
}

async function submit(gr) {
  const val = (id) => $(`#${id}`).value.trim();
  const gr_number = gr ? gr.gr_number : val('gr_number');
  if (!gr_number) {
    flash('GR Number is required.', 'error');
    return;
  }
  if (!$('#receiptForm').reportValidity()) return;

  const today = new Date().toISOString().slice(0, 10);
  const body = {
    po_number: val('po_number'),
    vendor_id: val('vendor_id'),
    vendor_name: val('vendor_name'),
    received_date: $('#received_date').value || today,
    received_by: val('received_by'),
    status: $('#status').value || 'partial',
    line_items: collectLines(),
  };

  const button = $('#submit');
  button.disabled = true;
  try {
    if (gr) await api('receiptslog', `/api/grs/${encodeURIComponent(gr_number)}`, { method: 'PUT', json: body });
    else await api('receiptslog', '/api/grs', { method: 'POST', json: { gr_number, ...body } });
  } catch (e) {
    flash(gr ? `Error updating GR: ${e.message}` : `Failed to create GR record. ${e.message}`, 'error');
    button.disabled = false;
    return;
  }
  flashNext(`GR ${gr_number} ${gr ? 'updated' : 'created'} successfully.`, 'success');
  location.href = url(`receiptslog/gr.html?n=${encodeURIComponent(gr_number)}`);
}

try {
  render(editing ? await api('receiptslog', `/api/gr/${encodeURIComponent(editing)}`) : null);
} catch (e) {
  flash(e.status === 404 ? `GR ${editing} was not found.` : e.message, 'error');
}
