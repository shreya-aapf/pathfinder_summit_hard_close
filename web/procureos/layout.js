import { requireLogin, signOut } from '../assets/js/auth.js';
import { consumeFlash, esc } from '../assets/js/ui.js';
import { url } from '../assets/js/site.js';

// Renders the ProcureOS chrome into #root and returns the element pages render into.
export function mountLayout(active, title) {
  const session = requireLogin();
  document.title = title;
  document.getElementById('root').innerHTML = `
    <nav class="topnav">
      <div class="topnav-inner">
        <a href="${url(`procureos/`)}" class="topnav-brand"><span class="brand-icon">&#9670;</span>ProcureOS</a>
        <div class="topnav-links">
          <a href="${url(`procureos/`)}" class="topnav-link ${active === 'pos' ? 'active' : ''}">Purchase Orders</a>
          <a href="${url(`procureos/api-keys.html`)}" class="topnav-link ${active === 'keys' ? 'active' : ''}">API Keys</a>
          <a href="${url('')}" class="topnav-link">All apps</a>
        </div>
        <div class="topnav-actions">
          <a href="${url(`procureos/form.html`)}" class="btn btn-primary btn-sm">+ New PO</a>
          <button type="button" class="btn btn-ghost btn-sm" id="signout">Sign out (${esc(session.username)})</button>
        </div>
      </div>
    </nav>
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
  const container = document.getElementById('flash');
  const el = document.createElement('div');
  el.className = `flash flash-${category}`;
  el.innerHTML = `<span>${esc(message)}</span><button class="flash-close" type="button">&#10005;</button>`;
  el.querySelector('.flash-close').addEventListener('click', () => el.remove());
  container.appendChild(el);
}
