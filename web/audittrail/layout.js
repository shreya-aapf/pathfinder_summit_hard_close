import { requireLogin, signOut } from '/assets/js/auth.js';
import { consumeFlash, esc } from '/assets/js/ui.js';

const ICONS = {
  board: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  flags: '<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>',
  flux: '<path d="M3 3v18h18"/><path d="M7 14l4-4 3 3 5-6"/>',
  log: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

export const svg = (inner, size = 16, width = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;

export const icon = (name, size, width) => svg(ICONS[name], size, width);

const NAV = [
  ['board', '/audittrail/', 'Close Status', 'board'],
  ['flags', '/audittrail/vendor-flags.html', 'Vendor Flags', 'flags'],
  ['flux', '/audittrail/flux.html', 'Flux Analysis', 'flux'],
  ['log', '/audittrail/audit-log.html', 'Audit Log', 'log'],
];

// Link to the matching ClearLedger invoice (ClearLedger is ported separately).
export const invoiceUrl = (number) => `/clearledger/invoice.html?number=${encodeURIComponent(number)}`;

// A reference tag; INV- references link out to ClearLedger.
export function refTag(ref) {
  return String(ref).startsWith('INV-')
    ? `<a href="${esc(invoiceUrl(ref))}" target="_blank" rel="noopener" class="ref-tag">${esc(ref)} ↗</a>`
    : `<span class="ref-tag">${esc(ref)}</span>`;
}

// Renders the AuditTrail chrome into #root and returns the element pages render into.
export function mountLayout(active, title) {
  const session = requireLogin();
  document.title = `${title} — AuditTrail`;
  document.getElementById('root').innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="sidebar-logo">
          <span class="logo-icon">&#9670;</span>
          <span class="logo-text">AuditTrail</span>
        </div>
        <nav class="sidebar-nav">
          ${NAV.map(([key, href, label, ic]) => `
            <a href="${href}" class="nav-link ${active === key ? 'active' : ''}">${icon(ic)} ${label}</a>`).join('')}
          <a href="/" class="nav-link">All apps</a>
        </nav>
        <div class="sidebar-footer">
          <button type="button" class="signout-btn" id="signout">Sign out (${esc(session.username)})</button>
          <span class="sidebar-footer-label">Hard Close</span>
          <span class="sidebar-footer-sub">Forensic Close Dashboard</span>
        </div>
      </aside>
      <main class="main" id="main"><div id="view"></div></main>
    </div>`;
  document.getElementById('signout').addEventListener('click', signOut);
  const pending = consumeFlash();
  if (pending) flash(pending.message, pending.category);
  return document.getElementById('view');
}

// Flask-style flash banner at the top of the main area.
export function flash(message, category = 'error') {
  const main = document.getElementById('main');
  let container = main.querySelector('.flash-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'flash-container';
    main.insertBefore(container, main.firstChild);
  }
  const el = document.createElement('div');
  el.className = `flash flash--${category}`;
  el.textContent = message;
  container.appendChild(el);
}

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

export const emptyState = (iconInner, title, subHtml) => `
  <div class="empty-state">
    <div class="empty-state-icon">${svg(iconInner, 48, 1.5)}</div>
    <p class="empty-state-title">${title}</p>
    <p class="empty-state-sub">${subHtml}</p>
  </div>`;

export const ICON_PATHS = ICONS;
