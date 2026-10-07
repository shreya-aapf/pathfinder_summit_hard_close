import { requireLogin, signOut } from '../assets/js/auth.js';
import { consumeFlash, esc } from '../assets/js/ui.js';
import { url } from '../assets/js/site.js';

const LINK_STYLE = 'background:none;border:0;cursor:pointer;font-family:inherit;';

// Renders the ReceiptsLog chrome into #root and returns the element pages render into.
export function mountLayout(active, title) {
  const session = requireLogin();
  document.title = title;
  document.getElementById('root').innerHTML = `
    <header class="topnav">
      <div class="topnav-inner">
        <a href="${url(`receiptslog/`)}" class="topnav-logo">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="5" width="16" height="12" rx="1.5" stroke="#E8601C" stroke-width="1.8"/>
            <path d="M6 5V4a4 4 0 0 1 8 0v1" stroke="#E8601C" stroke-width="1.8" stroke-linecap="round"/>
            <path d="M7 10h6M7 13h4" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
          ReceiptsLog
        </a>
        <nav class="topnav-links">
          <a href="${url(`receiptslog/`)}" class="topnav-link ${active === 'receipts' ? 'active' : ''}">Receipts</a>
          <a href="${url(`receiptslog/api-keys.html`)}" class="topnav-link ${active === 'keys' ? 'active' : ''}">API Keys</a>
          <a href="${url('')}" class="topnav-link">All apps</a>
        </nav>
        <div class="topnav-actions" style="display:flex;align-items:center;gap:12px;">
          <a href="${url(`receiptslog/form.html`)}" class="btn btn-primary btn-sm">+ New Receipt</a>
          <button type="button" class="topnav-link" style="${LINK_STYLE}" id="signout">Sign out (${esc(session.username)})</button>
        </div>
      </div>
    </header>
    <main class="main-content">
      <div class="flash-container" id="flash"></div>
      <div id="view"></div>
    </main>`;
  document.getElementById('signout').addEventListener('click', signOut);
  const pending = consumeFlash();
  if (pending) flash(pending.message, pending.category);
  return document.getElementById('view');
}

export function flash(message, category = 'success') {
  const el = document.createElement('div');
  el.className = `flash flash-${category}`;
  el.textContent = message;
  document.getElementById('flash').appendChild(el);
}

export const capitalize = (s) => {
  const t = String(s ?? '');
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
};

export const DELETE_MODAL = `
  <div id="deleteModal" class="modal-backdrop" style="display:none;">
    <div class="modal">
      <h3 class="modal-title">Delete Receipt?</h3>
      <p class="modal-body">This will permanently delete <strong id="deleteGrLabel"></strong> and all its line items. This cannot be undone.</p>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" data-modal-cancel>Cancel</button>
        <button type="button" class="btn btn-danger" data-modal-confirm>Delete</button>
      </div>
    </div>
  </div>`;
