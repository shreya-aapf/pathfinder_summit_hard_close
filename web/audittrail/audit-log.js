import { api } from '../assets/js/api.js';
import { esc } from '../assets/js/ui.js';
import { ICON_PATHS, emptyState, flash, mountLayout, refTag } from './layout.js';

const view = mountLayout('log', 'Audit Log');

let entries = [];
try {
  entries = await api('audittrail', '/api/audit-trail');
} catch (e) {
  flash(`Error loading audit trail: ${e.message}`, 'error');
}

const list = entries.length ? `
  <div class="audit-log">
    ${entries.map((entry) => `
    <div class="audit-entry ${entry.escalation_reason ? 'audit-entry--escalated' : ''}">
      <div class="audit-entry-time">${entry.created_at ? esc(String(entry.created_at).slice(0, 19).replace('T', ' ')) : '—'}</div>
      <div class="audit-entry-body">
        <div class="audit-entry-header">
          <span class="audit-entry-agent">${esc(entry.agent_name)}</span>
          <span class="audit-entry-action">checked <strong>${esc(entry.action_checked)}</strong> → decision: <strong>${esc(entry.decision)}</strong></span>
          ${entry.related_reference ? refTag(entry.related_reference) : ''}
          ${entry.escalation_reason ? '<span class="badge badge--urgent">Escalated</span>' : ''}
        </div>
        ${entry.evidence ? `<div class="audit-entry-evidence">${esc(entry.evidence)}</div>` : ''}
        ${entry.escalation_reason ? `<div class="audit-entry-escalation"><strong>Escalation reason:</strong> ${esc(entry.escalation_reason)}</div>` : ''}
      </div>
    </div>`).join('')}
  </div>` : emptyState(ICON_PATHS.log, 'No audit trail entries found', "The automation hasn't logged any checks yet.");

view.innerHTML = `
  <div class="page-header">
    <div>
      <h1 class="page-title">Audit Log</h1>
      <p class="page-subtitle">Every automated agent check and decision, in order — forensic. Every row is evidence.</p>
    </div>
  </div>
  ${list}`;
