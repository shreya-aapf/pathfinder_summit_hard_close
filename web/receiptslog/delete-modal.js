import { api } from '../assets/js/api.js';
import { flashNext } from '../assets/js/ui.js';
import { flash } from './layout.js';
import { url } from '../assets/js/site.js';

// Event-delegated delete confirmation. Any element with data-delete="<gr_number>" opens the modal
// rendered from DELETE_MODAL; confirming calls the API, then redirects to the list.
export function wireDeleteModal() {
  const modal = document.getElementById('deleteModal');
  let target = null;
  const close = () => { modal.style.display = 'none'; target = null; };

  document.addEventListener('click', async (e) => {
    const opener = e.target.closest('[data-delete]');
    if (opener) {
      target = opener.dataset.delete;
      document.getElementById('deleteGrLabel').textContent = target;
      modal.style.display = 'flex';
      return;
    }
    if (e.target === modal || e.target.closest('[data-modal-cancel]')) {
      close();
      return;
    }
    if (e.target.closest('[data-modal-confirm]') && target) {
      const number = target;
      close();
      try {
        await api('receiptslog', `/api/grs/${encodeURIComponent(number)}`, { method: 'DELETE' });
        flashNext(`GR ${number} deleted.`, 'success');
        location.href = url('receiptslog/');
      } catch (err) {
        flash(`Error deleting GR: ${err.message}`, 'error');
      }
    }
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
}
