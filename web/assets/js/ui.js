const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

// Escape every value that came from the database or the user before it goes into innerHTML.
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

export const money = (n) => Number(n || 0).toFixed(2);

export const titleCase = (s) => String(s ?? '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const param = (name) => new URLSearchParams(location.search).get(name);

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const FLASH_KEY = 'pathfinder_flash';

// Queue a message to show on the next page load (used before a redirect).
export function flashNext(message, category = 'success') {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, category }));
}

export function consumeFlash() {
  try {
    const item = JSON.parse(sessionStorage.getItem(FLASH_KEY));
    sessionStorage.removeItem(FLASH_KEY);
    return item;
  } catch {
    return null;
  }
}

// Show a message in `container` using the app's own flash classes, e.g. `flash flash-success`.
export function showFlash(container, message, category = 'success', className = (c) => `flash flash-${c}`) {
  const el = document.createElement('div');
  el.className = className(category);
  el.textContent = message;
  container.appendChild(el);
  return el;
}

export function pageTitle(text) {
  document.title = text;
}
