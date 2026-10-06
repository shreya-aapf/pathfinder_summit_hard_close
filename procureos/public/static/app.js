(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Line item management
  // ---------------------------------------------------------------------------

  function getBody() {
    return document.getElementById('line-items-body');
  }

  function rowCount() {
    var body = getBody();
    return body ? body.querySelectorAll('.line-item-row').length : 0;
  }

  function renumberRows() {
    var body = getBody();
    if (!body) return;
    var rows = body.querySelectorAll('.line-item-row');
    rows.forEach(function (row, idx) {
      var n = idx + 1;
      row.dataset.index = n;
      var numCell = row.querySelector('.line-number-cell');
      if (numCell) numCell.textContent = n;

      var fields = ['item_code', 'description', 'quantity', 'unit_price'];
      fields.forEach(function (field) {
        var input = row.querySelector('[name$="_' + field + '"]');
        if (input) input.name = 'line_item_' + n + '_' + field;
      });
    });
  }

  function recalcRow(input) {
    var row = input.closest('.line-item-row');
    if (!row) return;
    var qty = parseFloat(row.querySelector('.line-qty').value) || 0;
    var price = parseFloat(row.querySelector('.line-price').value) || 0;
    var amount = qty * price;
    var cell = row.querySelector('.line-amount-cell');
    if (cell) cell.textContent = amount.toFixed(2);
    updateFormTotal();
  }

  // Expose recalcRow so inline oninput can call it
  window.recalcRow = recalcRow;

  function updateFormTotal() {
    var body = getBody();
    if (!body) return;
    var cells = body.querySelectorAll('.line-amount-cell');
    var total = 0;
    cells.forEach(function (cell) {
      var val = parseFloat(cell.textContent) || 0;
      total += val;
    });
    var totalEl = document.getElementById('form-total');
    if (totalEl) totalEl.textContent = total.toFixed(2);
  }

  function buildRow(n) {
    var tr = document.createElement('tr');
    tr.className = 'line-item-row';
    tr.dataset.index = n;
    tr.innerHTML = [
      '<td class="line-number-cell">' + n + '</td>',
      '<td><input type="text" name="line_item_' + n + '_item_code" class="form-input form-input-sm" placeholder="SKU-001" /></td>',
      '<td><input type="text" name="line_item_' + n + '_description" class="form-input form-input-sm" placeholder="Item description" /></td>',
      '<td><input type="number" name="line_item_' + n + '_quantity" class="form-input form-input-sm line-qty" min="0" step="any" oninput="recalcRow(this)" /></td>',
      '<td><input type="number" name="line_item_' + n + '_unit_price" class="form-input form-input-sm line-price" min="0" step="any" oninput="recalcRow(this)" /></td>',
      '<td class="text-right line-amount-cell">0.00</td>',
      '<td class="text-center"><button type="button" class="btn-remove-row" onclick="removeLineItem(this)" title="Remove">&#10005;</button></td>',
    ].join('');
    return tr;
  }

  window.addLineItem = function () {
    var body = getBody();
    if (!body) return;
    var n = rowCount() + 1;
    body.appendChild(buildRow(n));
    updateFormTotal();
  };

  window.removeLineItem = function (btn) {
    var body = getBody();
    if (!body) return;
    // Keep at least one row
    if (rowCount() <= 1) return;
    var row = btn.closest('.line-item-row');
    if (row) row.remove();
    renumberRows();
    updateFormTotal();
  };

  // ---------------------------------------------------------------------------
  // Delete confirmation modal
  // ---------------------------------------------------------------------------

  window.openDeleteModal = function (poNumber) {
    var modal = document.getElementById('delete-modal');
    var labelEl = document.getElementById('delete-modal-po-number');
    var form = document.getElementById('delete-modal-form');
    if (!modal) return;
    if (labelEl) labelEl.textContent = poNumber;
    if (form) form.action = '/po/' + poNumber + '/delete';
    modal.style.display = 'flex';
  };

  window.closeDeleteModal = function () {
    var modal = document.getElementById('delete-modal');
    if (modal) modal.style.display = 'none';
  };

  // Close modal when clicking backdrop
  document.addEventListener('click', function (e) {
    var modal = document.getElementById('delete-modal');
    if (modal && e.target === modal) closeDeleteModal();
  });

  // Close on Escape
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeDeleteModal();
  });

  // ---------------------------------------------------------------------------
  // Init: compute totals on page load (for edit form pre-populated values)
  // ---------------------------------------------------------------------------

  document.addEventListener('DOMContentLoaded', function () {
    updateFormTotal();
  });

})();
