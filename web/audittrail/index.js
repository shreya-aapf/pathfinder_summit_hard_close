import { api } from '/assets/js/api.js';
import { esc, param } from '/assets/js/ui.js';
import { ICON_PATHS, emptyState, flash, mountLayout, refTag, showToast } from './layout.js';

const view = mountLayout('board', 'Close Status');
const statusFilter = (param('status') || '').trim() || 'all';

const BADGES = {
  escalated: ['urgent', 'Escalated'],
  exception_documented: ['amber', 'Exception Documented'],
  cleared: ['green', 'Cleared'],
};

const badge = (status) => {
  const b = BADGES[status];
  return b ? `<span class="badge badge--${b[0]}">${b[1]}</span>` : `<span class="badge badge--gray">${esc(status)}</span>`;
};

const stamp = (value, len) => (value ? esc(String(value).slice(0, len).replace('T', ' ')) : '—');

function render(items, counts) {
  const tabs = [
    ['all', 'All', counts.all],
    ['escalated', 'Escalated', counts.escalated],
    ['exception_documented', 'Exception Documented', counts.exception_documented],
    ['cleared', 'Cleared', counts.cleared],
  ];

  const body = items.length ? `
    <div class="table-wrap">
      <table class="data-table">
        <thead>
          <tr>
            <th>Item</th><th>Category</th><th>Status</th><th>Owner</th><th>Note</th>
            <th>Related Reference</th><th>Updated</th><th>Update</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((item) => `
          <tr class="${item.status === 'escalated' ? 'row--escalated' : ''}">
            <td>${esc(item.item_name)}</td>
            <td>${esc(item.category)}</td>
            <td>${badge(item.status)}</td>
            <td>${esc(item.owner || '—')}</td>
            <td class="text-muted">${esc(item.note || '—')}</td>
            <td class="cell-mono">${item.related_reference ? refTag(item.related_reference) : '—'}</td>
            <td class="cell-date">${stamp(item.updated_at, 16)}</td>
            <td>
              <form class="status-form" data-id="${esc(item.id)}">
                <select class="status-select">
                  <option value="cleared" ${item.status === 'cleared' ? 'selected' : ''}>Cleared</option>
                  <option value="exception_documented" ${item.status === 'exception_documented' ? 'selected' : ''}>Exception Documented</option>
                  <option value="escalated" ${item.status === 'escalated' ? 'selected' : ''}>Escalated</option>
                </select>
                <button type="submit" class="btn btn--primary btn--sm">Save</button>
              </form>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : emptyState(
      ICON_PATHS.board,
      'No close status items found',
      statusFilter !== 'all'
        ? `No items with status "${esc(statusFilter)}". <a href="/audittrail/">View all items</a>`
        : 'No close items have been recorded yet.',
    );

  view.innerHTML = `
    <div class="page-header">
      <div>
        <h1 class="page-title">Close Status Board</h1>
        <p class="page-subtitle">Every open item tracked to resolution — cleared, documented, or escalated</p>
      </div>
    </div>
    <div class="filter-tabs">
      ${tabs.map(([value, label, count]) => `
        <a href="?status=${value}" class="filter-tab ${statusFilter === value ? 'filter-tab--active' : ''}">
          ${label}
          <span class="tab-count tab-count--${value}">${count}</span>
        </a>`).join('')}
    </div>
    ${body}`;
}

view.addEventListener('submit', async (e) => {
  const form = e.target.closest('.status-form');
  if (!form) return;
  e.preventDefault();
  const select = form.querySelector('.status-select');
  const button = form.querySelector('button');
  const status = select ? select.value : null;
  if (!status) {
    showToast('Choose a status before saving.', 'error');
    return;
  }
  button.disabled = true;
  const originalText = button.textContent.trim();
  button.textContent = 'Saving…';
  try {
    await api('audittrail', `/api/close-status/${encodeURIComponent(form.dataset.id)}`, { method: 'PATCH', json: { status } });
    showToast('Close item updated — reloading…', 'success');
    setTimeout(() => location.reload(), 800);
  } catch (err) {
    showToast(err.status === 0 ? 'Network error. Please try again.' : err.message || 'An error occurred. Please try again.', 'error');
    button.disabled = false;
    button.textContent = originalText;
  }
});

let all = [];
try {
  all = await api('audittrail', '/api/close-status');
} catch (e) {
  flash(`Error loading close status board: ${e.message}`, 'error');
}

const counts = { cleared: 0, exception_documented: 0, escalated: 0 };
for (const row of all) if (row.status in counts) counts[row.status] += 1;
counts.all = counts.cleared + counts.exception_documented + counts.escalated;

const items = statusFilter === 'all' ? all : all.filter((r) => r.status === statusFilter);
render(items, counts);
