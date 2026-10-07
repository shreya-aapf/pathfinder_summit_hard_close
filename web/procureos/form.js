import { api } from '../assets/js/api.js';
import { $, $$, esc, flashNext, money, param } from '../assets/js/ui.js';
import { flash, mountLayout } from './layout.js';
import { url } from '../assets/js/site.js';

const TEXT_FIELDS = ['purchase_what', 'purchase_why', 'no_purchase_impact', 'alternative_tool', 'roi_benefit', 'okr_alignment'];
const STATUSES = [['open', 'Open'], ['partially_received', 'Partially Received'], ['closed', 'Closed'], ['cancelled', 'Cancelled']];
const CURRENCIES = ['USD', 'EUR', 'INR', 'GBP'];

const editing = param('n');
const mode = editing ? 'edit' : 'create';
const view = mountLayout('pos', `${mode === 'edit' ? 'Edit Purchase Order' : 'New Purchase Order'} — ProcureOS`);

const required = mode === 'create' ? 'required' : '';
const star = mode === 'create' ? '<span class="required">*</span>' : '';

const rowHtml = (n, item = {}) => `
  <tr class="line-item-row">
    <td class="line-number-cell">${n}</td>
    <td><input type="text" data-f="item_code" class="form-input form-input-sm" value="${esc(item.item_code || '')}" placeholder="SKU-001" /></td>
    <td><input type="text" data-f="description" class="form-input form-input-sm" value="${esc(item.description || '')}" placeholder="Item description" /></td>
    <td><input type="number" data-f="quantity" class="form-input form-input-sm line-qty" value="${esc(item.quantity ?? '')}" min="0" step="any" /></td>
    <td><input type="number" data-f="unit_price" class="form-input form-input-sm line-price" value="${esc(item.unit_price ?? '')}" min="0" step="any" /></td>
    <td class="text-right line-amount-cell">${money(item.amount)}</td>
    <td class="text-center"><button type="button" class="btn-remove-row" title="Remove">&#10005;</button></td>
  </tr>`;

function textarea(id, label, rows, value, placeholder = '') {
  return `
    <div class="form-field form-field--full">
      <label for="${id}" class="form-label">${label} ${star}</label>
      <textarea id="${id}" class="form-input form-textarea" rows="${rows}" ${required}${placeholder ? ` placeholder="${placeholder}"` : ''}>${esc(value || '')}</textarea>
    </div>`;
}

function render(po) {
  const j = po?.justification || {};
  const status = po?.status || 'open';
  const currency = po?.currency || 'USD';
  const lines = po?.line_items?.length ? po.line_items : [{}];
  const back = po ? url(`procureos/po.html?n=${encodeURIComponent(po.po_number)}`) : url('procureos/');

  view.innerHTML = `
    <div class="page-header">
      <div>
        <a href="${back}" class="back-link">&larr; ${po ? esc(po.po_number) : 'Purchase Orders'}</a>
        <h1 class="page-title">${po ? 'Edit Purchase Order' : 'New Purchase Order'}</h1>
      </div>
    </div>
    <form id="po-form" novalidate>
      <div class="form-card">
        <h2 class="form-section-title">PO Details</h2>
        <div class="form-grid">
          <div class="form-field">
            <label for="po_number" class="form-label">PO Number <span class="required">*</span></label>
            <input type="text" id="po_number" class="form-input" value="${esc(po?.po_number || '')}" ${po ? 'disabled' : 'required placeholder="PO-2024-0001"'} />
          </div>
          <div class="form-field">
            <label for="status" class="form-label">Status</label>
            <select id="status" class="form-input form-select">
              ${STATUSES.map(([v, l]) => `<option value="${v}" ${status === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="currency" class="form-label">Currency</label>
            <select id="currency" class="form-input form-select">
              ${CURRENCIES.map((c) => `<option value="${c}" ${currency === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </div>
          <div class="form-field">
            <label for="vendor_id" class="form-label">Vendor ID</label>
            <input type="text" id="vendor_id" class="form-input" value="${esc(po?.vendor_id || '')}" placeholder="VEND-001" />
          </div>
          <div class="form-field">
            <label for="vendor_name" class="form-label">Vendor Name</label>
            <input type="text" id="vendor_name" class="form-input" value="${esc(po?.vendor_name || '')}" placeholder="Acme Supplies Ltd" />
          </div>
          <div class="form-field">
            <label for="issue_date" class="form-label">Issue Date</label>
            <input type="date" id="issue_date" class="form-input" value="${esc(po?.issue_date || '')}" />
          </div>
          <div class="form-field">
            <label for="delivery_date" class="form-label">Delivery Date</label>
            <input type="date" id="delivery_date" class="form-input" value="${esc(po?.delivery_date || '')}" />
          </div>
        </div>
      </div>

      <div class="form-card">
        <h2 class="form-section-title">Purchase Justification</h2>
        <div class="form-grid">
          ${textarea('purchase_what', 'What are you purchasing?', 2, j.purchase_what)}
          ${textarea('purchase_why', 'Why do we need to purchase this?', 3, j.purchase_why)}
          ${textarea('no_purchase_impact', "What will happen if we don't make this purchase?", 3, j.no_purchase_impact)}
          <div class="form-field">
            <label for="criticality" class="form-label">Is this keep-the-lights-on or nice to have? ${star}</label>
            <select id="criticality" class="form-input form-select" ${required}>
              <option value="" ${j.criticality ? '' : 'selected'}>Select…</option>
              <option value="keep_the_lights_on" ${j.criticality === 'keep_the_lights_on' ? 'selected' : ''}>Keep the lights on</option>
              <option value="nice_to_have" ${j.criticality === 'nice_to_have' ? 'selected' : ''}>Nice to have</option>
            </select>
          </div>
          ${textarea('alternative_tool', 'Do we have another tool/service that does 70-80% of what this does?', 2, j.alternative_tool, 'Name the tool, or write &quot;No&quot;')}
          ${textarea('roi_benefit', 'What is the ROI or benefit of the services?', 3, j.roi_benefit)}
          ${textarea('okr_alignment', 'What other OKRs of your team is the purchase tied to?', 2, j.okr_alignment)}
        </div>
      </div>

      <div class="form-card">
        <h2 class="form-section-title">Supporting Document</h2>
        <div class="form-field">
          <label for="document" class="form-label">Quote, proposal or contract (optional)</label>
          <input type="file" id="document" class="form-input" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.doc,.docx,.xls,.xlsx" />
          ${po?.document_name ? `<span class="text-muted">Currently attached: ${esc(po.document_name)}. Choosing a file replaces it.</span>` : ''}
        </div>
      </div>

      <div class="form-card" id="line-items-card">
        <div class="form-section-header">
          <h2 class="form-section-title">Line Items</h2>
          <button type="button" class="btn btn-secondary btn-sm" id="add-line">+ Add Line Item</button>
        </div>
        <div class="table-wrapper">
          <table class="data-table line-items-table">
            <thead><tr>
              <th style="width:50px;">#</th><th>Item Code</th><th>Description</th>
              <th style="width:110px;">Quantity</th><th style="width:130px;">Unit Price</th>
              <th style="width:130px;" class="text-right">Amount</th><th style="width:60px;"></th>
            </tr></thead>
            <tbody id="line-items-body">${lines.map((item, i) => rowHtml(i + 1, item)).join('')}</tbody>
            <tfoot><tr class="total-row">
              <td colspan="5" class="text-right"><strong>Total</strong></td>
              <td class="text-right font-mono" id="form-total">0.00</td><td></td>
            </tr></tfoot>
          </table>
        </div>
      </div>

      <div class="form-actions">
        <a href="${back}" class="btn btn-ghost">Cancel</a>
        <button type="submit" class="btn btn-primary" id="submit">${po ? 'Save Changes' : 'Create Purchase Order'}</button>
      </div>
    </form>`;

  wireLineItems();
  $('#po-form').addEventListener('submit', (e) => { e.preventDefault(); submit(po); });
}

function wireLineItems() {
  const body = $('#line-items-body');

  const updateTotal = () => {
    const total = $$('.line-amount-cell', body).reduce((sum, cell) => sum + (parseFloat(cell.textContent) || 0), 0);
    $('#form-total').textContent = total.toFixed(2);
  };
  const renumber = () => $$('.line-item-row', body).forEach((row, i) => { $('.line-number-cell', row).textContent = i + 1; });

  body.addEventListener('input', (e) => {
    const row = e.target.closest('.line-item-row');
    if (!row || !e.target.matches('.line-qty, .line-price')) return;
    const qty = parseFloat($('.line-qty', row).value) || 0;
    const price = parseFloat($('.line-price', row).value) || 0;
    $('.line-amount-cell', row).textContent = (qty * price).toFixed(2);
    updateTotal();
  });
  body.addEventListener('click', (e) => {
    if (!e.target.closest('.btn-remove-row') || $$('.line-item-row', body).length <= 1) return;
    e.target.closest('.line-item-row').remove();
    renumber();
    updateTotal();
  });
  $('#add-line').addEventListener('click', () => {
    body.insertAdjacentHTML('beforeend', rowHtml($$('.line-item-row', body).length + 1));
    updateTotal();
  });
  updateTotal();
}

function collectLines() {
  const lines = [];
  $$('.line-item-row').forEach((row) => {
    const get = (f) => $(`[data-f="${f}"]`, row).value.trim();
    const item_code = get('item_code');
    if (!item_code) return;
    lines.push({
      line_number: lines.length + 1,
      item_code,
      description: get('description'),
      quantity: parseFloat(get('quantity')) || 0,
      unit_price: parseFloat(get('unit_price')) || 0,
    });
  });
  return lines;
}

async function submit(po) {
  const form = $('#po-form');
  if (!form.reportValidity()) return;
  const line_items = collectLines();
  if (!line_items.length) {
    flash('At least one line item is required.', 'error');
    return;
  }

  const justification = { criticality: $('#criticality').value };
  for (const f of TEXT_FIELDS) justification[f] = $(`#${f}`).value.trim();
  // Existing POs predate the questions, so blank answers are stored as empty instead of rejected.
  if (po) for (const k of Object.keys(justification)) justification[k] = justification[k] || null;

  const body = {
    vendor_id: $('#vendor_id').value.trim(),
    vendor_name: $('#vendor_name').value.trim(),
    issue_date: $('#issue_date').value || null,
    delivery_date: $('#delivery_date').value || null,
    status: $('#status').value,
    currency: $('#currency').value,
    ...justification,
    line_items,
  };

  const button = $('#submit');
  button.disabled = true;
  let number = po?.po_number;
  try {
    if (po) {
      await api('procureos', `/api/pos/${encodeURIComponent(number)}`, { method: 'PUT', json: body });
    } else {
      number = $('#po_number').value.trim();
      await api('procureos', '/api/pos', { method: 'POST', json: { po_number: number, ...body } });
    }
  } catch (e) {
    flash(po ? `Error updating PO: ${e.message}` : `Error creating PO: ${e.message}`, 'error');
    button.disabled = false;
    return;
  }

  const verb = po ? 'updated' : 'created';
  const file = $('#document').files[0];
  if (file) {
    try {
      const form = new FormData();
      form.set('file', file);
      await api('procureos', `/api/pos/${encodeURIComponent(number)}/document`, { method: 'POST', form });
    } catch (e) {
      flashNext(`Purchase Order ${number} ${verb}, but the document upload failed: ${e.message}`, 'error');
      location.href = url(`procureos/po.html?n=${encodeURIComponent(number)}`);
      return;
    }
  }
  flashNext(`Purchase Order ${number} ${verb}.`, 'success');
  location.href = url(`procureos/po.html?n=${encodeURIComponent(number)}`);
}

try {
  render(editing ? await api('procureos', `/api/po/${encodeURIComponent(editing)}`) : null);
} catch (e) {
  flash(e.status === 404 ? `Purchase order ${editing} was not found.` : e.message, 'error');
}
