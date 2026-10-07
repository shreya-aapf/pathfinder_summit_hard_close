import { requireLogin, signOut } from '../assets/js/auth.js';
import { esc } from '../assets/js/ui.js';
import { url } from '../assets/js/site.js';

const ICONS = {
  balance: '<rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="9" x2="9" y2="21"/>',
  intercompany: '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  accruals: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
};

export const icon = (name, size = 16, stroke = 2) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round">${ICONS[name]}</svg>`;

const NAV = [
  ['balance', url('meridiangl/'), 'Balance Sheet'],
  ['intercompany', url('meridiangl/intercompany.html'), 'Intercompany'],
  ['accruals', url('meridiangl/accruals.html'), 'Accruals'],
];

// Renders the MeridianGL chrome (sidebar + main) into #root and returns the content element.
export function mountLayout(active, title) {
  const session = requireLogin();
  document.title = `${title} — MeridianGL`;
  document.getElementById('root').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <span class="logo-icon">&#9642;</span>
        <span class="logo-text">MeridianGL</span>
      </div>
      <nav class="sidebar-nav">
        ${NAV.map(([key, href, label]) => `
        <a href="${href}" class="nav-link ${active === key ? 'active' : ''}">${icon(key)}
          ${label}
        </a>`).join('')}
        <a href="${url('')}" class="nav-link">All apps</a>
        <button type="button" class="nav-link" id="signout" style="background:none;border:0;width:100%;cursor:pointer;font-family:inherit;text-align:left;">Sign out (${esc(session.username)})</button>
      </nav>
      <div class="sidebar-footer">
        <span class="sidebar-footer-label">3-Subsidiary Close</span>
        <span class="sidebar-footer-sub">GL Balance Sheet Viewer</span>
      </div>
    </aside>
    <main class="main">
      <div class="flash-container" id="flash"></div>
      <div id="view"></div>
    </main>
  </div>`;
  document.getElementById('signout').addEventListener('click', signOut);
  return document.getElementById('view');
}

export function flash(message, category = 'error') {
  const el = document.createElement('div');
  el.className = `flash flash--${category}`;
  el.textContent = message;
  document.getElementById('flash').appendChild(el);
}

// Python-style "%.2f" for a number (em dash for missing values).
export const fmt = (n) => (n === null || n === undefined || n === '' ? '—' : Number(n).toFixed(2));

// Filter tabs, as links (same as the Flask templates).
export function tabs(items, current, hrefFor) {
  return `<div class="filter-tabs">${items.map(([value, label]) => `
    <a href="${esc(hrefFor(value))}" class="filter-tab ${current === value ? 'filter-tab--active' : ''}">${esc(label)}</a>`).join('')}
  </div>`;
}

export function empty(iconName, title, sub) {
  return `
<div class="empty-state">
  <div class="empty-state-icon">${icon(iconName, 44, 1.5)}</div>
  <p class="empty-state-title">${esc(title)}</p>
  <p class="empty-state-sub">${sub}</p>
</div>`;
}

export const SUBSIDIARIES = ['A', 'B', 'C'];

// Normalises a ?subsidiary= value exactly like the Flask page routes.
export function subsidiaryParam(raw) {
  const v = (raw || '').trim().toUpperCase();
  return SUBSIDIARIES.includes(v) ? v : '';
}
