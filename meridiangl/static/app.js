/* MeridianGL — app.js
   This app is read-only (no forms, no actions), so there is nothing that
   needs to run client-side. Filter tabs are plain links with query params,
   same pattern as the sibling apps' status filters.

   showToast is kept here for consistency with the sibling apps' static
   asset shape even though nothing in this app currently triggers it. */

function showToast(message, type) {
  type = type || 'info';

  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = 'toast toast--' + type;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(function () {
    toast.style.transition = 'opacity .3s';
    toast.style.opacity = '0';
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 300);
  }, 3000);
}
