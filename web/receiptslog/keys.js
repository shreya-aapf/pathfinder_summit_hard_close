import { api } from '/assets/js/api.js';
import { $, esc } from '/assets/js/ui.js';
import { flash, mountLayout } from './layout.js';

const view = mountLayout('keys', 'API Keys — ReceiptsLog');
let newKey = null;

async function load() {
  try {
    const { keys } = await api('receiptslog', '/api/keys');
    render(keys);
  } catch (e) {
    flash(`Could not load API keys: ${e.message}`, 'error');
  }
}

function render(keys) {
  view.innerHTML = `
    <div class="page-header"><div>
      <h1 class="page-title">API Keys</h1>
      <p class="page-subtitle">Keys authenticate requests to <code>/api/*</code> endpoints via the <code>X-API-Key</code> header. A key is shown only once — copy it immediately.</p>
    </div></div>
    ${newKey ? `
      <div class="card" style="border-left: 3px solid #16a34a; margin-bottom: 1.5rem;">
        <h2 class="card-title" style="color: #16a34a;">New key created — copy it now</h2>
        <p style="color: #64748b; font-size: 0.875rem; margin-bottom: 0.75rem;">This value will not be shown again.</p>
        <div style="display:flex; align-items:center; gap:0.75rem;">
          <code style="font-size:0.85rem; background:#f1f5f9; padding:0.5rem 0.75rem; border-radius:6px; flex:1; word-break:break-all;">${esc(newKey)}</code>
          <button class="btn btn-secondary btn-sm" id="copy-key" type="button">Copy</button>
        </div>
      </div>` : ''}
    <div class="card" style="margin-bottom: 1.5rem;">
      <h2 class="card-title">Generate a new key</h2>
      <form id="key-form" style="display:flex; gap:0.75rem; align-items:flex-end; margin-top:0.75rem;">
        <div style="flex:1;">
          <label class="form-label" for="key-label">Label</label>
          <input type="text" id="key-label" class="form-input" placeholder="e.g. AA Bot, Postman test" maxlength="100" />
        </div>
        <button type="submit" class="btn btn-primary">Generate</button>
      </form>
    </div>
    <div class="card">
      <h2 class="card-title">Active keys</h2>
      ${keys.length ? `
        <table style="width:100%; border-collapse:collapse; margin-top:0.75rem; font-size:0.875rem;">
          <thead><tr style="border-bottom:1px solid #e2e8f0; text-align:left;">
            <th style="padding:0.5rem 0.75rem; color:#64748b; font-weight:500;">Label</th>
            <th style="padding:0.5rem 0.75rem; color:#64748b; font-weight:500;">Created</th>
            <th style="padding:0.5rem 0.75rem;"></th>
          </tr></thead>
          <tbody>${keys.map((k) => `
            <tr style="border-bottom:1px solid #f1f5f9;">
              <td style="padding:0.6rem 0.75rem;">${esc(k.label || '—')}</td>
              <td style="padding:0.6rem 0.75rem; color:#64748b;">${esc(k.created_at ? k.created_at.slice(0, 10) : '—')}</td>
              <td style="padding:0.6rem 0.75rem; text-align:right;">
                <button type="button" class="btn btn-secondary btn-sm" style="color:#dc2626;" data-revoke="${esc(k.id)}">Revoke</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>` : '<p style="color:#64748b; margin-top:0.5rem; font-size:0.875rem;">No keys yet. The demo key (<code>demo-key-receipthub</code>) always works.</p>'}
    </div>`;

  const copy = $('#copy-key');
  if (copy) copy.addEventListener('click', () => navigator.clipboard.writeText(newKey).then(() => { copy.textContent = 'Copied!'; }));

  $('#key-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const made = await api('receiptslog', '/api/keys', { method: 'POST', json: { label: $('#key-label').value } });
      newKey = made.key;
    } catch (err) {
      flash(`Could not create key: ${err.message}`, 'error');
      return;
    }
    await load();
  });

  view.querySelectorAll('[data-revoke]').forEach((btn) => btn.addEventListener('click', async () => {
    if (!confirm('Revoke this key? Any automation using it will stop working immediately.')) return;
    try {
      await api('receiptslog', `/api/keys/${encodeURIComponent(btn.dataset.revoke)}`, { method: 'DELETE' });
      newKey = null;
      flash('API key revoked.', 'success');
    } catch (err) {
      flash(`Could not revoke key: ${err.message}`, 'error');
    }
    await load();
  }));
}

await load();
