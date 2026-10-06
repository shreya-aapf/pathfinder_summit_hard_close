/* AuditTrail — app.js */

// -----------------------------------------------------------------------
// Toast utility
// -----------------------------------------------------------------------

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

// -----------------------------------------------------------------------
// Close status inline update (close status board)
// -----------------------------------------------------------------------

function submitCloseStatusUpdate(event, form, itemId) {
  event.preventDefault();

  const statusSelect = form.querySelector('.status-select');
  const button = form.querySelector('button');
  const status = statusSelect ? statusSelect.value : null;

  if (!status) {
    showToast('Choose a status before saving.', 'error');
    return false;
  }

  button.disabled = true;
  const originalText = button.textContent.trim();
  button.textContent = 'Saving…';

  fetch(window.APP_ROOT + '/api/close-status/' + itemId, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: status }),
  })
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (result.ok) {
        showToast('Close item updated — reloading…', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 800);
      } else {
        showToast(result.data.error || 'An error occurred. Please try again.', 'error');
        button.disabled = false;
        button.textContent = originalText;
      }
    })
    .catch(function () {
      showToast('Network error. Please try again.', 'error');
      button.disabled = false;
      button.textContent = originalText;
    });

  return false;
}
