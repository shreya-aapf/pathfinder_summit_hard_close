/* ClearLedger — app.js */

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
// Invoice action buttons (detail page)
// -----------------------------------------------------------------------

function submitAction(button) {
  const invoiceId = button.getAttribute('data-invoice-id');
  const action    = button.getAttribute('data-action');
  const noteEl    = document.getElementById('action-note');
  const note      = noteEl ? noteEl.value.trim() : '';

  // Disable all action buttons while the request is in flight
  const allButtons = document.querySelectorAll('.action-buttons .btn');
  allButtons.forEach(function (btn) {
    btn.disabled = true;
  });

  const originalText = button.textContent.trim();
  button.textContent = 'Saving…';

  fetch(window.APP_ROOT + '/ui/invoices/' + invoiceId + '/action', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: action, note: note }),
  })
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, status: res.status, data: data };
      });
    })
    .then(function (result) {
      if (result.ok) {
        showToast('Action saved — reloading…', 'success');
        setTimeout(function () {
          window.location.reload();
        }, 800);
      } else {
        showToast(result.data.error || 'An error occurred. Please try again.', 'error');
        allButtons.forEach(function (btn) { btn.disabled = false; });
        button.textContent = originalText;
      }
    })
    .catch(function () {
      showToast('Network error. Please try again.', 'error');
      allButtons.forEach(function (btn) { btn.disabled = false; });
      button.textContent = originalText;
    });
}

// -----------------------------------------------------------------------
// Settings form — threshold update
// -----------------------------------------------------------------------

function submitThreshold(event) {
  event.preventDefault();

  const input  = document.getElementById('threshold-input');
  const saveBtn = document.getElementById('save-btn');
  const value  = parseFloat(input.value);

  if (isNaN(value) || value < 0 || value > 100) {
    showToast('Enter a number between 0 and 100.', 'error');
    return;
  }

  saveBtn.disabled = true;
  saveBtn.textContent = 'Saving…';

  fetch(window.APP_ROOT + '/ui/settings/threshold', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ threshold_pct: value }),
  })
    .then(function (res) {
      return res.json().then(function (data) {
        return { ok: res.ok, data: data };
      });
    })
    .then(function (result) {
      if (result.ok) {
        showToast('Threshold updated to ' + result.data.threshold_pct + '%', 'success');
        // Refresh the page so the "Current Threshold" display updates
        setTimeout(function () {
          window.location.reload();
        }, 1200);
      } else {
        showToast(result.data.error || 'Failed to save. Please try again.', 'error');
        saveBtn.disabled = false;
        saveBtn.textContent = 'Save Threshold';
      }
    })
    .catch(function () {
      showToast('Network error. Please try again.', 'error');
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Threshold';
    });
}
