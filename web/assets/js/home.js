import { requireLogin, signOut } from './auth.js';
import { esc } from './ui.js';

const APPS = [
  { name: 'ClearLedger', path: '/clearledger/', blurb: 'Invoice review portal for flagged 3-way match results.' },
  { name: 'ProcureOS', path: '/procureos/', blurb: 'Purchase orders, justification answers and supporting documents.' },
  { name: 'ReceiptHub', path: '/receipthub/', blurb: 'Goods received records against purchase orders.' },
  { name: 'AuditTrail', path: '/audittrail/', blurb: 'Forensic close dashboard: vendor flags, flux analysis and close status.' },
  { name: 'MeridianGL', path: '/meridiangl/', blurb: 'GL balance sheet, intercompany log and accruals by subsidiary.' },
];

const session = requireLogin();
document.getElementById('username').textContent = session.username;
document.getElementById('signout').addEventListener('click', signOut);
document.getElementById('apps').innerHTML = APPS.map((a) => `
  <a class="card" href="${esc(a.path)}">
    <h2>${esc(a.name)}</h2>
    <p>${esc(a.blurb)}</p>
  </a>`).join('');
