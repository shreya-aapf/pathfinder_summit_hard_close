import { err, json } from './http.ts';

const enc = new TextEncoder();
const dec = new TextDecoder();

// A token lasts 7 days. The web pages swap it for a fresh one (POST /auth/refresh) once half the
// time has passed, so a user who keeps coming back stays signed in.
export const TOKEN_TTL_SECONDS = 7 * 24 * 3600;

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function hmacHex(secret: string, body: Uint8Array | string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const data = typeof body === 'string' ? enc.encode(body) : body;
  const sig = await crypto.subtle.sign('HMAC', key, data);
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

// Login tokens are signed with AUTH_SECRET when set, otherwise with a value derived from the
// service role key, so no extra secret is required to deploy.
async function signingKey(): Promise<CryptoKey> {
  const secret = Deno.env.get('AUTH_SECRET') || Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('No signing secret available');
  return crypto.subtle.importKey('raw', enc.encode(`pathfinder-auth-v1:${secret}`), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signToken(username: string): Promise<{ token: string; expires_at: number }> {
  const expires_at = Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS;
  const payload = b64url(enc.encode(JSON.stringify({ u: username, exp: expires_at })));
  const sig = await crypto.subtle.sign('HMAC', await signingKey(), enc.encode(payload));
  return { token: `${payload}.${b64url(new Uint8Array(sig))}`, expires_at };
}

export async function verifyToken(token: string): Promise<string | null> {
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  try {
    const valid = await crypto.subtle.verify('HMAC', await signingKey(), b64urlDecode(sig), enc.encode(payload));
    if (!valid) return null;
    const { u, exp } = JSON.parse(dec.decode(b64urlDecode(payload)));
    return typeof u === 'string' && typeof exp === 'number' && exp > Date.now() / 1000 ? u : null;
  } catch {
    return null;
  }
}

export async function userFromRequest(req: Request): Promise<string | null> {
  const m = /^Bearer\s+(.+)$/i.exec(req.headers.get('authorization') ?? '');
  return m ? verifyToken(m[1]) : null;
}

// SHA-256 of a single key accepted by every API-key-protected app (ClearLedger, ProcureOS,
// ReceiptsLog, MeridianGL). Only the hash is stored here.
const UNIVERSAL_KEY_HASH = 'ee2d26546ef631749775b3d1cb5aec03375773b5d6fe40edf8196e53d281f1a0';

export interface KeyAuthConfig {
  table: string;
  demoHash: string;
  missing: { message: string; status: number };
  invalid: { message: string; status: number };
}

// Returns null when the request may proceed, or the error Response to send. A valid login token
// (used by the web UI) or a valid X-API-Key (used by automation) is accepted.
// deno-lint-ignore no-explicit-any
export async function authenticate(req: Request, db: any, cfg: KeyAuthConfig): Promise<Response | null> {
  if (await userFromRequest(req)) return null;
  const key = req.headers.get('x-api-key') ?? '';
  if (!key) return err(cfg.missing.message, cfg.missing.status);
  const hash = await sha256Hex(key);
  if (hash === cfg.demoHash || hash === UNIVERSAL_KEY_HASH) return null;
  const { data, error } = await db.from(cfg.table).select('id').eq('key_hash', hash).limit(1);
  if (error) return err('Authentication check failed', 500);
  return data && data.length ? null : err(cfg.invalid.message, cfg.invalid.status);
}

export async function requireUser(req: Request): Promise<{ user: string } | Response> {
  const user = await userFromRequest(req);
  return user ? { user } : err('Sign in required', 401);
}

export function randomKey(prefix: string): string {
  return `${prefix}-${b64url(crypto.getRandomValues(new Uint8Array(32)))}`;
}

export { json };
