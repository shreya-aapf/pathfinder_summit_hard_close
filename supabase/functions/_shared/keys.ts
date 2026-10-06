import { json, noContent, err, readJson } from './http.ts';
import { randomKey, requireUser, sha256Hex } from './auth.ts';
import type { Router } from './router.ts';

// Adds GET/POST /api/keys and DELETE /api/keys/:id. These need a login token, not an API key,
// so automation credentials cannot mint or revoke other credentials.
// deno-lint-ignore no-explicit-any
export function addKeyManagement(router: Router, db: any, table: string, prefix: string): void {
  router.get('/api/keys', async ({ req }) => {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const { data, error } = await db.from(table).select('id, label, created_at').order('created_at', { ascending: false });
    if (error) return err('Could not load API keys', 500);
    return json({ keys: data ?? [] });
  });

  router.post('/api/keys', async ({ req }) => {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const body = (await readJson(req)) ?? {};
    const label = String(body.label ?? '').trim().slice(0, 100) || 'Unnamed key';
    const key = randomKey(prefix);
    const { data, error } = await db
      .from(table)
      .insert({ key_hash: await sha256Hex(key), label, created_at: new Date().toISOString() })
      .select('id')
      .single();
    if (error) return err('Could not create key', 500);
    return json({ id: data.id, label, key }, 201);
  });

  router.delete('/api/keys/:id', async ({ req, params }) => {
    const auth = await requireUser(req);
    if (auth instanceof Response) return auth;
    const { error } = await db.from(table).delete().eq('id', params.id);
    if (error) return err('Could not revoke key', 500);
    return noContent();
  });
}
