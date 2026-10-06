import { api } from '/assets/js/api.js';
import { $, flashNext } from '/assets/js/ui.js';
import { flash, mountLayout } from './layout.js';

const view = mountLayout('upload', 'Upload Invoice');

view.innerHTML = `
  <div class="page-header">
    <div>
      <h1 class="page-title">Upload Invoice</h1>
      <p class="page-subtitle">
        Attach the invoice document and enter its header details. The file is stored in the
        Supabase <code>documents</code> bucket and the invoice joins the queue as pending.
      </p>
    </div>
  </div>
  <div class="settings-card">
    <div class="settings-form-section">
      <form id="upload-form" class="settings-form">
        <div class="field-group">
          <label class="field-label" for="document">Invoice file <span class="required">*</span></label>
          <input type="file" id="document" name="document" class="text-input" required accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" />
          <p class="field-hint">PDF, PNG, JPG or TIFF, up to 10 MB.</p>
        </div>
        <div class="form-row">
          <div class="field-group">
            <label class="field-label" for="invoice_number">Invoice number <span class="required">*</span></label>
            <input type="text" id="invoice_number" name="invoice_number" class="text-input" required placeholder="INV-2024-010" />
          </div>
          <div class="field-group">
            <label class="field-label" for="invoice_date">Invoice date</label>
            <input type="date" id="invoice_date" name="invoice_date" class="text-input" />
          </div>
        </div>
        <div class="form-row">
          <div class="field-group">
            <label class="field-label" for="vendor_id">Vendor ID <span class="required">*</span></label>
            <input type="text" id="vendor_id" name="vendor_id" class="text-input" required placeholder="VEND-001" />
          </div>
          <div class="field-group">
            <label class="field-label" for="vendor_name">Vendor name <span class="required">*</span></label>
            <input type="text" id="vendor_name" name="vendor_name" class="text-input" required placeholder="Acme Supplies Ltd" />
          </div>
        </div>
        <div class="form-row">
          <div class="field-group">
            <label class="field-label" for="po_number">PO number <span class="required">*</span></label>
            <input type="text" id="po_number" name="po_number" class="text-input" required placeholder="PO-2024-0099" />
          </div>
          <div class="field-group">
            <label class="field-label" for="gr_number">GR number</label>
            <input type="text" id="gr_number" name="gr_number" class="text-input" placeholder="GR-2024-0044" />
          </div>
        </div>
        <div class="field-group">
          <label class="field-label" for="total_amount">Total amount <span class="required">*</span></label>
          <input type="number" id="total_amount" name="total_amount" class="text-input" required min="0" step="0.01" placeholder="1250.00" />
        </div>
        <button type="submit" class="btn btn--primary" id="submit-btn">Upload Invoice</button>
      </form>
    </div>
  </div>`;

$('#upload-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#submit-btn');
  $('#flash').innerHTML = '';
  btn.disabled = true;
  btn.textContent = 'Uploading…';
  try {
    const invoice = await api('clearledger', '/api/invoices/upload', { method: 'POST', form: new FormData(e.target) });
    flashNext(`Invoice ${invoice.invoice_number} uploaded.`, 'success');
    location.href = `/clearledger/invoice.html?id=${encodeURIComponent(invoice.id)}`;
  } catch (err) {
    flash(err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Upload Invoice';
    window.scrollTo(0, 0);
  }
});
