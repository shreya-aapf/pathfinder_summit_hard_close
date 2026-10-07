import { api } from '../assets/js/api.js';
import { esc, flashNext, param } from '../assets/js/ui.js';
import { flash, invoiceUrl, mountLayout, svg } from './layout.js';
import { url } from '../assets/js/site.js';

const view = mountLayout('flags', 'Vendor Flag');

const statusBadge = (s) => s === 'open' ? '<span class="badge badge--urgent">Open</span>'
  : s === 'escalated' ? '<span class="badge badge--escalated">Escalated</span>'
  : s === 'cleared' ? '<span class="badge badge--green">Cleared</span>'
  : `<span class="badge badge--gray">${esc(s)}</span>`;

const notFound = () => {
  flashNext('Vendor flag not found.', 'error');
  location.replace(url('audittrail/vendor-flags.html'));
};

const id = param('id');
let flag = null;
if (!id) {
  notFound();
} else {
  try {
    flag = await api('audittrail', `/api/vendor-flags/${encodeURIComponent(id)}`);
  } catch {
    notFound();
  }
}

if (flag) {
  document.title = `${flag.vendor_name} — AuditTrail`;
  const inv = flag.invoice_number;
  const invLink = inv ? `<a href="${esc(invoiceUrl(inv))}" target="_blank" rel="noopener"` : '';

  view.innerHTML = `
    <a href="${url(`audittrail/vendor-flags.html`)}" class="back-link">
      ${svg('<polyline points="15 18 9 12 15 6"/>', 14, 2.5)}
      Vendor Flags
    </a>

    <div class="detail-header">
      <div class="detail-header-left">
        <h1 class="page-title">${esc(flag.vendor_name)}</h1>
        <div class="detail-meta">
          <span><strong>Vendor ID:</strong> <span class="cell-mono">${esc(flag.vendor_id)}</span></span>
          ${inv ? `<span><strong>Invoice:</strong> ${invLink} class="cell-mono">${esc(inv)} ↗</a></span>` : ''}
          <span><strong>Severity:</strong> ${esc(flag.severity)}</span>
        </div>
      </div>
      <div class="detail-header-right">${statusBadge(flag.status)}</div>
    </div>

    ${flag.flag_type === 'bank_mismatch' ? `
    <div class="mismatch-banner">
      <div class="mismatch-banner-icon">
        ${svg('<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>', 20)}
      </div>
      <div class="mismatch-banner-body">
        <div class="mismatch-banner-title">Bank detail mismatch on file</div>
        <div class="mismatch-banner-detail">
          Registered bank details do not match the details submitted with ${esc(inv || 'this record')}. Do not release payment until verified.
        </div>
      </div>
    </div>` : ''}

    <section class="section">
      <h2 class="section-title">Evidence — Registered vs. Submitted</h2>
      <div class="evidence-grid">
        <div class="evidence-card">
          <div class="evidence-card-label">Registered Bank Details</div>
          <div class="evidence-card-value">${esc(flag.registered_bank_details)}</div>
        </div>
        <div class="evidence-card evidence-card--mismatch">
          <div class="evidence-card-label">Submitted Bank Details</div>
          <div class="evidence-card-value">${esc(flag.submitted_bank_details)}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <h2 class="section-title">Flag Details</h2>
      <div class="table-wrap">
        <table class="data-table">
          <tbody>
            <tr><td><strong>Flag Type</strong></td><td>${esc(flag.flag_type)}</td></tr>
            <tr>
              <td><strong>Linked Invoice</strong></td>
              <td class="cell-mono">${inv ? `${invLink}>${esc(inv)} ↗</a>` : '—'}</td>
            </tr>
            <tr>
              <td><strong>Flagged On</strong></td>
              <td class="cell-date">${flag.created_at ? esc(String(flag.created_at).slice(0, 16).replace('T', ' ')) : '—'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>`;
}
