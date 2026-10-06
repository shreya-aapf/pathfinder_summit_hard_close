import { api, openDocument } from '/assets/js/api.js';
import { $, esc, flashNext, money, param, titleCase } from '/assets/js/ui.js';
import { flash, mountLayout } from './layout.js';

const CRITICALITY = { keep_the_lights_on: 'Keep the lights on', nice_to_have: 'Nice to have' };

const number = param('n');
const view = mountLayout('pos', `${number || 'Purchase Order'} — ProcureOS`);

function render(po) {
  const j = po.justification;
  const questions = [
    ['What are you purchasing?', j.purchase_what],
    ['Why do we need to purchase this?', j.purchase_why],
    ["What will happen if we don't make this purchase?", j.no_purchase_impact],
    ['Keep the lights on or nice to have?', CRITICALITY[j.criticality]],
    ['Another tool/service that does 70-80% of this?', j.alternative_tool],
    ['ROI or benefit of the services', j.roi_benefit],
    ['Other team OKRs this purchase is tied to', j.okr_alignment],
  ];
  const n = encodeURIComponent(po.po_number);
  const currency = po.currency || 'USD';

  view.innerHTML = `
    <div class="page-header">
      <div>
        <a href="/procureos/" class="back-link">&larr; Purchase Orders</a>
        <h1 class="page-title">${esc(po.po_number)}</h1>
      </div>
      <div class="header-actions">
        <a href="/clearledger/?po_number=${n}" target="_blank" rel="noopener" class="btn btn-secondary">View in ClearLedger ↗</a>
        <a href="/receipthub/?search=${n}" target="_blank" rel="noopener" class="btn btn-secondary">View in ReceiptHub ↗</a>
        <a href="/procureos/form.html?n=${n}" class="btn btn-secondary">Edit</a>
        <button type="button" class="btn btn-danger" id="delete-open">Delete</button>
      </div>
    </div>

    <div class="detail-grid">
      <div class="card po-header-card">
        <div class="card-row">
          <div class="card-field"><span class="field-label">PO Number</span><span class="field-value font-mono">${esc(po.po_number)}</span></div>
          <div class="card-field"><span class="field-label">Status</span><span class="badge badge-${esc(po.status)}">${esc(titleCase(po.status))}</span></div>
        </div>
        <div class="card-row">
          <div class="card-field"><span class="field-label">Vendor Name</span><span class="field-value">${esc(po.vendor_name || '—')}</span></div>
          <div class="card-field"><span class="field-label">Vendor ID</span><span class="field-value font-mono">${esc(po.vendor_id || '—')}</span></div>
        </div>
        <div class="card-row">
          <div class="card-field"><span class="field-label">Issue Date</span><span class="field-value">${esc(po.issue_date || '—')}</span></div>
          <div class="card-field"><span class="field-label">Delivery Date</span><span class="field-value">${esc(po.delivery_date || '—')}</span></div>
        </div>
      </div>
    </div>

    <div class="section-header"><h2 class="section-title">Purchase Justification</h2></div>
    <div class="card justification-card">
      ${questions.map(([label, answer]) => `
        <div class="card-field"><span class="field-label">${esc(label)}</span><span class="field-value">${esc(answer || '—')}</span></div>`).join('')}
      <div class="card-field">
        <span class="field-label">Supporting Document</span>
        <span class="field-value">${po.document_name ? `<a href="#" id="open-document">${esc(po.document_name)} ↗</a>` : '—'}</span>
      </div>
    </div>

    <div class="section-header"><h2 class="section-title">Line Items</h2></div>
    <div class="table-wrapper">
      <table class="data-table">
        <thead><tr>
          <th class="text-center" style="width:60px;">#</th><th>Item Code</th><th>Description</th>
          <th class="text-right">Quantity</th><th class="text-right">Unit Price</th><th class="text-right">Amount</th>
        </tr></thead>
        <tbody>${po.line_items.length ? po.line_items.map((item) => `
          <tr>
            <td class="text-center">${esc(item.line_number)}</td>
            <td class="font-mono">${esc(item.item_code)}</td>
            <td>${esc(item.description || '—')}</td>
            <td class="text-right font-mono">${esc(item.quantity)}</td>
            <td class="text-right font-mono">${money(item.unit_price)}</td>
            <td class="text-right font-mono">${money(item.amount)}</td>
          </tr>`).join('') : '<tr><td colspan="6" class="text-center text-muted">No line items.</td></tr>'}
        </tbody>
        <tfoot><tr class="total-row">
          <td colspan="5" class="text-right"><strong>Total</strong></td>
          <td class="text-right font-mono"><strong>${esc(currency)} ${money(po.total_amount)}</strong></td>
        </tr></tfoot>
      </table>
    </div>

    <div id="delete-modal" class="modal-overlay" style="display:none;" role="dialog" aria-modal="true">
      <div class="modal">
        <h2 class="modal-title">Delete Purchase Order</h2>
        <p class="modal-body">Are you sure you want to delete <strong>${esc(po.po_number)}</strong>? This action cannot be undone.</p>
        <div class="modal-footer">
          <button type="button" class="btn btn-ghost" id="delete-cancel">Cancel</button>
          <button type="button" class="btn btn-danger" id="delete-confirm">Delete</button>
        </div>
      </div>
    </div>`;

  const modal = $('#delete-modal');
  const close = () => { modal.style.display = 'none'; };
  $('#delete-open').addEventListener('click', () => { modal.style.display = 'flex'; });
  $('#delete-cancel').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#delete-confirm').addEventListener('click', async () => {
    close();
    try {
      await api('procureos', `/api/pos/${n}`, { method: 'DELETE' });
      flashNext(`Purchase Order ${po.po_number} deleted.`, 'success');
      location.href = '/procureos/';
    } catch (e) {
      flash(`Error deleting PO: ${e.message}`, 'error');
    }
  });

  const docLink = $('#open-document');
  if (docLink) {
    docLink.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await openDocument('procureos', `/api/pos/${n}/document`);
      } catch (err) {
        flash(`Could not open document: ${err.message}`, 'error');
      }
    });
  }
}

if (!number) {
  location.replace('/procureos/');
} else {
  try {
    render(await api('procureos', `/api/po/${encodeURIComponent(number)}`));
  } catch (e) {
    view.innerHTML = `
      <div class="page-header"><div><a href="/procureos/" class="back-link">&larr; Purchase Orders</a>
      <h1 class="page-title">Not found</h1></div></div>
      <div class="empty-state"><p class="empty-message">${e.status === 404 ? `Purchase order ${esc(number)} was not found.` : esc(e.message)}</p></div>`;
  }
}
