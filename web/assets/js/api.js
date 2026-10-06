import { API_BASE } from './config.js';
import { clearSession, getSession, redirectToLogin } from './auth.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// api('procureos', '/api/pos', { method: 'POST', json: {...} })
// Sends the login token, returns parsed JSON (or a Blob for files, or null for 204) and throws
// ApiError for non-2xx responses. A 401 on an authenticated call sends the user to the login page.
export async function api(fn, path, { method = 'GET', json, form, auth = true } = {}) {
  const headers = {};
  const session = auth ? getSession() : null;
  if (session) headers.Authorization = `Bearer ${session.token}`;

  let body;
  if (json !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(json);
  } else if (form) {
    body = form;
  }

  let res;
  try {
    res = await fetch(`${API_BASE}/${fn}${path}`, { method, headers, body });
  } catch {
    throw new ApiError(0, 'Network error. Please try again.');
  }

  if (res.status === 401 && auth) {
    clearSession();
    redirectToLogin();
    throw new ApiError(401, 'Sign in required');
  }
  if (res.status === 204) return null;

  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : await res.blob();
  if (!res.ok) throw new ApiError(res.status, (isJson && data.error) || `Request failed (${res.status})`);
  return data;
}

// Opens a stored document in a new tab via its short-lived signed URL. The tab is opened
// synchronously so popup blockers allow it.
export async function openDocument(fn, path) {
  const win = window.open('', '_blank');
  try {
    const { url } = await api(fn, path);
    if (win) win.location = url;
  } catch (e) {
    if (win) win.close();
    throw e;
  }
}
