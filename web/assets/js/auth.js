const STORAGE_KEY = 'pathfinder_session';

export function getSession() {
  try {
    const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (s && s.token && s.expires_at > Date.now() / 1000) return s;
  } catch { /* fall through */ }
  localStorage.removeItem(STORAGE_KEY);
  return null;
}

export function saveSession({ token, expires_at, username }) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, expires_at, username }));
}

export function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

export function safeNext(value, fallback = '/') {
  return value && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : fallback;
}

export function redirectToLogin() {
  const next = encodeURIComponent(location.pathname + location.search);
  location.replace(`/login.html?next=${next}`);
}

// Call at the top of every protected page. The pages themselves are static; the data is
// protected because every API call needs this session's token.
export function requireLogin() {
  const session = getSession();
  if (!session) {
    redirectToLogin();
    throw new Error('Sign in required');
  }
  return session;
}

export function signOut() {
  clearSession();
  location.href = '/login.html';
}
