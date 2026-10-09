import { api, openDocument } from '../assets/js/api.js';
import { $, esc, flashNext, formatMoney, param } from '../assets/js/ui.js';
import { flash, mountLayout, showToast } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('queue', 'Invoice');

const STATUS_BADGE = { pending: ['amber', 'Pending'], approved: ['green', 'Approved'], escalated: ['purple', 'Escalated'], contacted: ['blue', 'Contacted'] };
const MISMATCH_BADGE = {
  ok: ['gray', 'OK'], price_variance: ['red', 'Price Variance'],
  qty_mismatch: ['amber', 'Qty Mismatch'], missing_gr: ['purple', 'Missing GR'],
};
const ACTION_BADGE = { approve: ['green', 'Approved'], contact_vendor: ['blue', 'Contact Vendor'], escalate: ['purple', 'Escalated'] };

let cur = (n) => formatMoney(n);
const badge = ([cls, label]) => `<span class="badge badge--${cls}">${esc(label)}</span>`;
const ALERT_ICON = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>';
const WARN_ICON = '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
const svg = (inner, size = 20, sw = 2) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

async function resolveId() {
  const id = param('id');
  if (id) return id;
  const number = param('number');
  if (!number) return null;
  const { id: found } = await api('clearledger', `/api/invoices/lookup/${encodeURIComponent(number)}`);
  return found;
}

function render(inv) {
  const id = inv.id;
  cur = (n) => formatMoney(n, inv.currency);
  const vp = parseFloat(inv.variance_pct) || 0;
  const threshold = Number(inv.threshold_pct ?? 2.5);
  const high = vp > threshold;
  const po = encodeURIComponent(inv.po_number ?? '');
  document.title = `${inv.invoice_number} — ClearLedger`;

  const flag = inv.vendor_flag ? `
    <div class="match-summary match-summary--high" style="margin-bottom: 14px;">
      <div class="match-summary-icon">${svg(ALERT_ICON)}</div>
      <div class="match-summary-body">
        <div class="match-summary-title">Vendor flagged in AuditTrail — ${esc(String(inv.vendor_flag.flag_type ?? '').replace(/_/g, ' '))}</div>
        <div class="match-summary-detail">Do not release payment until this is resolved.</div>
      </div>
      <div class="match-summary-badge">
        <a href="${url(`audittrail/vendor-flag.html?id=${encodeURIComponent(inv.vendor_flag.id)}`)}" target="_blank" rel="noopener" class="btn btn--escalate" style="width:auto; padding: 6px 14px;">View in AuditTrail ↗</a>
      </div>
    </div>` : '';

  const matchTitle = !inv.match_status ? 'Not yet matched against PO and GR' : high ? 'Variance exceeds threshold' : 'Variance within tolerance';
  const matchBadge = inv.match_status === 'mismatch' ? badge(['red', 'Mismatch'])
    : !inv.match_status ? badge(['gray', 'Awaiting Match']) : badge(['amber', 'Partial Match']);

  const lines = inv.line_items.length ? `
    <div class="table-wrap">
      <table class="data-table line-table">
        <thead>
          <tr>
            <th style="width:48px">#</th><th>Description</th>
            <th colspan="2" class="group-header">Invoice</th>
            <th colspan="2" class="group-header">Purchase Order</th>
            <th class="group-header">GR</th><th>Variance</th><th>Mismatch</th>
          </tr>
          <tr class="sub-header">
            <th></th><th></th><th>Qty</th><th>Unit Price</th><th>Qty</th><th>Unit Price</th><th>Qty</th><th></th><th></th>
          </tr>
        </thead>
        <tbody>${inv.line_items.map((li) => `
          <tr class="line-item-row line-item-row--${esc(li.mismatch_type)}">
            <td class="cell-center">${esc(li.line_number)}</td>
            <td>${esc(li.description)}</td>
            <td class="cell-num">${esc(li.invoice_qty)}</td>
            <td class="cell-num">${esc(cur(li.invoice_unit_price))}</td>
            <td class="cell-num ${li.po_qty !== li.invoice_qty ? 'cell-diff' : ''}">${esc(li.po_qty)}</td>
            <td class="cell-num ${li.po_unit_price !== li.invoice_unit_price ? 'cell-diff' : ''}">${esc(cur(li.po_unit_price))}</td>
            <td class="cell-num ${li.gr_qty !== li.invoice_qty ? 'cell-diff' : ''}">${esc(li.gr_qty)}</td>
            <td class="cell-num cell-variance">${li.variance_amount ? `${esc(cur(li.variance_amount))}` : '—'}</td>
            <td>${badge(MISMATCH_BADGE[li.mismatch_type] || ['gray', li.mismatch_type ?? ''])}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '<p class="text-muted">No line items available for this invoice.</p>';

  const doc = inv.document_path
    ? `<div class="doc-card-current"><a href="#" id="open-document" class="link-plain">${esc(inv.document_name)} ↗</a></div>`
    : '<p class="text-muted">No document attached yet.</p>';

  const history = inv.actions.length ? `
    <div class="timeline">${inv.actions.map((a) => `
      <div class="timeline-item">
        <div class="timeline-dot timeline-dot--${esc(a.action_type)}"></div>
        <div class="timeline-body">
          <div class="timeline-header">
            ${badge(ACTION_BADGE[a.action_type] || ['gray', a.action_type ?? ''])}
            <span class="timeline-time">${esc(a.actioned_at ? a.actioned_at.slice(0, 16).replace('T', ' ') : '')}</span>
          </div>
          ${a.note ? `<div class="timeline-note">${esc(a.note)}</div>` : ''}
        </div>
      </div>`).join('')}
    </div>` : '<p class="text-muted">No actions taken yet.</p>';

  const actionBtn = (cls, action, label, icon) =>
    `<button class="btn btn--${cls}" data-action="${action}">${svg(icon, 14, 2)}${label}</button>`;

  view.innerHTML = `
    <div class="detail-layout">
      <div class="detail-main">
        <a href="${url(`clearledger/`)}" class="back-link">${svg('<polyline points="15 18 9 12 15 6"/>', 14, 2.5)} Invoice Queue</a>

        <div class="detail-header">
          <div class="detail-header-left">
            <h1 class="page-title">${esc(inv.invoice_number)}</h1>
            <div class="detail-meta">
              <span><strong>Vendor:</strong> ${esc(inv.vendor_name)} (${esc(inv.vendor_id)})</span>
              <span><strong>Date:</strong> ${esc(inv.invoice_date ?? '')}</span>
              <span><strong>PO:</strong> <a href="${url(`procureos/po.html?n=${po}`)}" target="_blank" rel="noopener" class="link-plain">${esc(inv.po_number)} ↗</a></span>
              ${inv.gr_number ? `<span><strong>GR:</strong> <a href="${url(`receiptslog/gr.html?n=${encodeURIComponent(inv.gr_number)}`)}" target="_blank" rel="noopener" class="link-plain">${esc(inv.gr_number)} ↗</a></span>` : ''}
            </div>
          </div>
          <div class="detail-header-right">
            <div class="total-amount">${esc(cur(inv.total_amount))}</div>
            <div class="total-label">Total Invoice Amount</div>
          </div>
        </div>

        ${flag}

        <div class="match-summary match-summary--${high ? 'high' : 'low'}">
          <div class="match-summary-icon">${svg(high ? ALERT_ICON : WARN_ICON)}</div>
          <div class="match-summary-body">
            <div class="match-summary-title">${matchTitle}</div>
            <div class="match-summary-detail">
              Variance: <strong>${esc(cur(inv.variance_amount))}</strong> &nbsp;|&nbsp;
              <strong>${vp.toFixed(2)}%</strong> &nbsp;vs threshold ${threshold.toFixed(1)}%
            </div>
          </div>
          <div class="match-summary-badge">${matchBadge}</div>
        </div>

        <section class="section"><h2 class="section-title">Line Items</h2>${lines}</section>

        <section class="section">
          <h2 class="section-title">Invoice Document</h2>
          <div class="doc-card">
            ${doc}
            <form id="doc-form" class="doc-card-form">
              <input type="file" id="doc-file" name="document" class="text-input" required accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff" />
              <button type="submit" class="btn btn--primary btn--inline">${inv.document_path ? 'Replace' : 'Attach'}</button>
            </form>
          </div>
        </section>

        <section class="section"><h2 class="section-title">Action History</h2>${history}</section>
      </div>

      <aside class="action-panel">
        <div class="action-panel-inner">
          <div class="action-panel-header">
            <h3 class="action-panel-title">Take Action</h3>
            <div class="action-current-status">Current:&nbsp;${STATUS_BADGE[inv.status] ? badge(STATUS_BADGE[inv.status]) : ''}</div>
          </div>
          <label class="field-label" for="action-note">Notes</label>
          <textarea id="action-note" class="notes-textarea" placeholder="Add a note about this decision (optional)…" rows="4"></textarea>
          <div class="action-buttons">
            ${actionBtn('approve', 'approve', 'Approve Invoice', '<polyline points="20 6 9 17 4 12"/>')}
            ${actionBtn('contact', 'contact_vendor', 'Contact Vendor', '<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>')}
            ${actionBtn('escalate', 'escalate', 'Escalate', '<polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/>')}
          </div>
        </div>
      </aside>
    </div>`;

  wireActions(id);
  wireDocument(id, inv);
}

function wireActions(id) {
  const buttons = view.querySelectorAll('.action-buttons .btn');
  buttons.forEach((button) => button.addEventListener('click', async () => {
    const note = $('#action-note').value.trim();
    buttons.forEach((b) => { b.disabled = true; });
    const original = button.innerHTML;
    button.textContent = 'Saving…';
    try {
      await api('clearledger', `/api/invoices/${encodeURIComponent(id)}/action`, {
        method: 'PATCH', json: { action: button.dataset.action, note },
      });
      showToast('Action saved — reloading…', 'success');
      setTimeout(() => location.reload(), 800);
    } catch (e) {
      showToast(e.message || 'An error occurred. Please try again.', 'error');
      buttons.forEach((b) => { b.disabled = false; });
      button.innerHTML = original;
    }
  }));
}

function wireDocument(id, inv) {
  const link = $('#open-document');
  if (link) {
    link.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await openDocument('clearledger', `/api/invoices/${encodeURIComponent(id)}/document`);
      } catch {
        flash('No document found for this invoice.', 'error');
      }
    });
  }
  $('#doc-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = $('#doc-file').files[0];
    if (!file) {
      flash('Please choose a file to upload.', 'error');
      return;
    }
    const form = new FormData();
    form.set('file', file, file.name);
    try {
      await api('clearledger', `/api/invoices/${encodeURIComponent(id)}/document`, { method: 'POST', form });
      flashNext(`Document "${file.name}" attached.`, 'success');
      location.reload();
    } catch (err) {
      flash(err.message, 'error');
    }
  });
}

try {
  const id = await resolveId();
  if (!id) {
    location.replace(url('clearledger/'));
  } else {
    render(await api('clearledger', `/api/invoices/${encodeURIComponent(id)}`));
  }
} catch (e) {
  if (e.status === 404) {
    flashNext(param('number') ? `No invoice found with number ${param('number')}.` : 'Invoice not found.', 'error');
    location.replace(url('clearledger/'));
  } else {
    flash(`Error loading invoice: ${e.message}`, 'error');
  }
}
