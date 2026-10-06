import { requireLogin, signOut } from '/assets/js/auth.js';
import { consumeFlash, esc, showFlash } from '/assets/js/ui.js';

const flashClass = (category) => `flash flash--${category}`;

const ICONS = {
  queue: '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="1" ry="1"/><line x1="9" y1="12" x2="15" y2="12"/><line x1="9" y1="16" x2="13" y2="16"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M4.93 4.93a10 10 0 0 0 0 14.14"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>',
  keys: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  apps: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
};

const icon = (name) => `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

// Renders the ClearLedger chrome (sidebar layout) into #root and returns the element pages render into.
export function mountLayout(active, title) {
  const session = requireLogin();
  document.title = `${title} — ClearLedger`;
  const link = (key, href, iconName, label) =>
    `<a href="${href}" class="nav-link ${active === key ? 'active' : ''}">${icon(iconName)}${label}</a>`;
  document.getElementById('root').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <span class="logo-icon">&#9632;</span>
          <span class="logo-text">ClearLedger</span>
        </div>
        <nav class="sidebar-nav">
          ${link('queue', '/clearledger/', 'queue', 'Invoice Queue')}
          ${link('upload', '/clearledger/upload.html', 'upload', 'Upload Invoice')}
          ${link('settings', '/clearledger/settings.html', 'settings', 'Settings')}
          ${link('keys', '/clearledger/api-keys.html', 'keys', 'API Keys')}
          ${link('', '/', 'apps', 'All apps')}
        </nav>
        <div class="sidebar-footer">
          <span class="sidebar-footer-label">3-Way Matching</span>
          <span class="sidebar-footer-sub">Invoice Review Portal</span>
          <button type="button" id="signout" class="nav-link" style="margin-top:12px; width:100%; background:none; border:0; cursor:pointer; font-family:inherit; padding-left:0;">Sign out (${esc(session.username)})</button>
        </div>
      </aside>
      <main class="main">
        <div class="flash-container" id="flash"></div>
        <div id="view"></div>
      </main>
    </div>`;
  document.getElementById('signout').addEventListener('click', signOut);
  const pending = consumeFlash();
  if (pending) flash(pending.message, pending.category);
  return document.getElementById('view');
}

export function flash(message, category = 'success') {
  showFlash(document.getElementById('flash'), message, category, flashClass);
}

// Toast utility (port of showToast in the Flask app.js).
export function showToast(message, type = 'info') {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = `toast toast--${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}
