import { api } from '../assets/js/api.js';
import { $, esc } from '../assets/js/ui.js';
import { flash, mountLayout, showToast } from './layout.js';

const view = mountLayout('settings', 'Settings');

function render(setting) {
  const updated = setting.updated_at ? setting.updated_at.slice(0, 16).replace('T', ' ') : '';
  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Matching Threshold</h1>
        <p class="page-subtitle">
          The automation flags any invoice where the variance exceeds this percentage.
          Adjust this to control what reaches your review queue.
        </p>
      </div>
    </div>
    <div class="settings-card">
      <div class="settings-current">
        <div class="settings-current-label">Current Threshold</div>
        <div class="settings-current-value">${esc(setting.threshold_pct)}%</div>
        ${updated ? `<div class="settings-updated">Last modified: ${esc(updated)} UTC</div>` : ''}
      </div>
      <div class="settings-divider"></div>
      <div class="settings-form-section">
        <h2 class="settings-form-title">Update Tolerance</h2>
        <p class="settings-form-desc">
          Invoices with a variance at or below this percentage will pass the matching check automatically.
          Only invoices exceeding this threshold are routed to this review portal.
        </p>
        <form id="threshold-form" class="settings-form">
          <div class="field-group">
            <label class="field-label" for="threshold-input">Tolerance (%)</label>
            <div class="input-row">
              <input type="number" id="threshold-input" name="threshold_pct" class="number-input" step="0.1" min="0" max="100" value="${esc(setting.threshold_pct)}" placeholder="e.g. 2.5" />
              <span class="input-unit">%</span>
            </div>
            <p class="field-hint">Example: setting 2.5 means invoices with less than 2.5% variance are auto-approved by the automation.</p>
          </div>
          <button type="submit" class="btn btn--primary" id="save-btn">Save Threshold</button>
        </form>
      </div>
    </div>
    <div class="settings-info-box">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      <p>
        Changes take effect on the <em>next</em> automation run. Invoices already in the queue are not re-evaluated.
        Use <code>GET /api/settings/threshold</code> to read the current value programmatically.
      </p>
    </div>`;

  $('#threshold-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = parseFloat($('#threshold-input').value);
    if (Number.isNaN(value) || value < 0 || value > 100) {
      showToast('Enter a number between 0 and 100.', 'error');
      return;
    }
    const btn = $('#save-btn');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const res = await api('clearledger', '/api/settings/threshold', { method: 'PUT', json: { threshold_pct: value } });
      showToast(`Threshold updated to ${res.threshold_pct}%`, 'success');
      setTimeout(() => location.reload(), 1200);
    } catch (err) {
      showToast(err.message || 'Failed to save. Please try again.', 'error');
      btn.disabled = false;
      btn.textContent = 'Save Threshold';
    }
  });
}

try {
  render(await api('clearledger', '/api/settings/threshold'));
} catch (e) {
  flash(`Error loading settings: ${e.message}`, 'error');
}
