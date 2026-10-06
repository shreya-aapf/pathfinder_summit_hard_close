// Track next line number
let lineCount = (function () {
  const rows = document.querySelectorAll('.line-item-row');
  return rows.length || 1;
})();

function addLineItem() {
  lineCount++;
  const n = lineCount;
  const tbody = document.getElementById('lineItemsBody');
  if (!tbody) return;

  const tr = document.createElement('tr');
  tr.className = 'line-item-row';
  tr.dataset.line = n;
  tr.innerHTML = `
    <td class="line-num-cell">${n}</td>
    <td><input type="text" name="line_item_${n}_item_code" class="form-control form-control-sm" placeholder="ITEM-001" /></td>
    <td><input type="text" name="line_item_${n}_description" class="form-control form-control-sm" placeholder="Description" /></td>
    <td><input type="number" name="line_item_${n}_quantity_ordered" class="form-control form-control-sm num" min="0" step="any" placeholder="0" onchange="updateVariance(this)" onkeyup="updateVariance(this)" /></td>
    <td class="rcv-cell">
      <input type="number" name="line_item_${n}_quantity_received" class="form-control form-control-sm num" min="0" step="any" placeholder="0" onchange="updateVariance(this)" onkeyup="updateVariance(this)" />
      <span class="variance-warn" style="display:none;" title="Received less than ordered">!</span>
    </td>
    <td><input type="number" name="line_item_${n}_unit_price" class="form-control form-control-sm num" min="0" step="0.01" placeholder="0.00" /></td>
    <td>
      <select name="line_item_${n}_condition" class="form-control form-control-sm">
        <option value="good">Good</option>
        <option value="damaged">Damaged</option>
        <option value="rejected">Rejected</option>
      </select>
    </td>
    <td><button type="button" class="btn-remove-line" onclick="removeLine(this)" title="Remove line">&times;</button></td>
  `;
  tbody.appendChild(tr);
}

function removeLine(btn) {
  const row = btn.closest('tr');
  if (!row) return;
  const tbody = row.parentElement;
  // Keep at least one row
  if (tbody.querySelectorAll('.line-item-row').length <= 1) return;
  row.remove();
  renumberLines();
}

function renumberLines() {
  const rows = document.querySelectorAll('.line-item-row');
  rows.forEach((row, i) => {
    const num = i + 1;
    const cell = row.querySelector('.line-num-cell');
    if (cell) cell.textContent = num;
    // Rename all inputs in the row to the correct line number
    row.querySelectorAll('input, select').forEach(el => {
      if (el.name) {
        el.name = el.name.replace(/line_item_\d+_/, `line_item_${num}_`);
      }
    });
    row.dataset.line = num;
  });
  lineCount = rows.length;
}

// Called on ordered qty or received qty change
function updateVariance(input) {
  const row = input.closest('tr');
  if (!row) return;
  const orderedInput = row.querySelector('input[name$="_quantity_ordered"]');
  const receivedInput = row.querySelector('input[name$="_quantity_received"]');
  const warnEl = row.querySelector('.variance-warn');
  if (!orderedInput || !receivedInput || !warnEl) return;

  const ordered = parseFloat(orderedInput.value) || 0;
  const received = parseFloat(receivedInput.value) || 0;

  if (ordered > 0 && received < ordered) {
    warnEl.style.display = 'inline';
    receivedInput.style.borderColor = 'var(--amber)';
  } else {
    warnEl.style.display = 'none';
    receivedInput.style.borderColor = '';
  }
}

// Run variance check on all rows after page load (edit mode)
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.line-item-row').forEach(row => {
    const orderedInput = row.querySelector('input[name$="_quantity_ordered"]');
    if (orderedInput) updateVariance(orderedInput);
  });
});

// ---- Delete modal ----
function openDeleteModal(grNumber) {
  const modal = document.getElementById('deleteModal');
  const label = document.getElementById('deleteGrLabel');
  const form = document.getElementById('deleteForm');
  if (!modal || !label || !form) return;
  label.textContent = grNumber;
  form.action = '/gr/' + encodeURIComponent(grNumber) + '/delete';
  modal.style.display = 'flex';
}

function closeDeleteModal() {
  const modal = document.getElementById('deleteModal');
  if (modal) modal.style.display = 'none';
}

// Close modal on backdrop click
document.addEventListener('click', function (e) {
  const modal = document.getElementById('deleteModal');
  if (modal && e.target === modal) closeDeleteModal();
});

// Close modal on Escape
document.addEventListener('keydown', function (e) {
  if (e.key === 'Escape') closeDeleteModal();
});
