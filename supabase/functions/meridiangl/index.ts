import { db } from '../_shared/db.ts';
import { err, json } from '../_shared/http.ts';
import { Router } from '../_shared/router.ts';
import { authenticate, type KeyAuthConfig } from '../_shared/auth.ts';

const KEY_AUTH: KeyAuthConfig = {
  table: 'gl_api_keys',
  demoHash: '13a70133e81abd62377bc38332fc4507ff5f8ef9d56e309611f59b6546af0fb4',
  missing: { message: 'Unauthorized', status: 401 },
  invalid: { message: 'Unauthorized', status: 401 },
};

const SUBSIDIARIES = ['A', 'B', 'C'];
const PAGE = 1000;

// deno-lint-ignore no-explicit-any
type Row = Record<string, any>;
// deno-lint-ignore no-explicit-any
type Build = () => any;

// The Supabase API caps one select at 1000 rows, so page through with a stable order.
// `build` must return a fresh query (already filtered and ordered) on each call.
async function fetchAll(build: Build): Promise<Row[]> {
  const all: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build().range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < PAGE) return all;
  }
}

const accountsQuery = (subsidiary?: string) => () => {
  let q = db.from('gl_accounts').select('*').order('subsidiary').order('account_code').order('id');
  if (subsidiary) q = q.eq('subsidiary', subsidiary);
  return q;
};

const balancesQuery = (period?: string) => () => {
  let q = db.from('gl_balances').select('*').order('id');
  if (period) q = q.eq('period', period);
  return q;
};

const intercompanyQuery = (flag_type?: string) => () => {
  let q = db.from('intercompany_log').select('*').order('posted_date_from', { ascending: false }).order('id');
  if (flag_type) q = q.eq('flag_type', flag_type);
  return q;
};

const accrualsQuery = (subsidiary?: string, status?: string, period?: string) => () => {
  let q = db.from('accruals').select('*').order('subsidiary').order('period', { ascending: false }).order('id');
  if (subsidiary) q = q.eq('subsidiary', subsidiary);
  if (status) q = q.eq('status', status);
  if (period) q = q.eq('period', period);
  return q;
};

// Latest balance per account: lexicographically latest period ('YYYY-MM').
function latestBalancePerAccount(balances: Row[]): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const b of balances) {
    const current = latest.get(b.account_id);
    if (!current || b.period > current.period) latest.set(b.account_id, b);
  }
  return latest;
}

const router = new Router();
const guard = async (req: Request) => await authenticate(req, db, KEY_AUTH);
const fail = (e: unknown) => err((e as Error).message, 500);

router.get('/api/gl/accounts', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const subsidiary = (query.get('subsidiary') ?? '').trim().toUpperCase();
  try {
    return json(await fetchAll(accountsQuery(subsidiary)));
  } catch (e) {
    return fail(e);
  }
});

router.get('/api/gl/balances', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const subsidiary = (query.get('subsidiary') ?? '').trim().toUpperCase();
  const period = (query.get('period') ?? '').trim();

  let accounts: Row[];
  let balances: Row[];
  try {
    accounts = await fetchAll(accountsQuery(subsidiary));
    balances = await fetchAll(balancesQuery(period));
  } catch (e) {
    return fail(e);
  }
  const byId = new Map(accounts.map((a) => [a.id, a]));

  const results: Row[] = [];
  for (const b of balances) {
    const acc = byId.get(b.account_id);
    // Balance belongs to an account outside the requested subsidiary
    if (subsidiary && !acc) continue;
    const entry: Row = { ...b };
    if (acc) {
      entry.subsidiary = acc.subsidiary;
      entry.account_code = acc.account_code;
      entry.account_name = acc.account_name;
      entry.account_type = acc.account_type;
    }
    results.push(entry);
  }
  return json(results);
});

router.get('/api/gl/intercompany', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const subsidiary = (query.get('subsidiary') ?? '').trim().toUpperCase();
  const flag_type = (query.get('flag_type') ?? '').trim();
  try {
    let entries = await fetchAll(intercompanyQuery(flag_type));
    if (subsidiary) entries = entries.filter((e) => e.subsidiary_from === subsidiary || e.subsidiary_to === subsidiary);
    return json(entries);
  } catch (e) {
    return fail(e);
  }
});

// `period` is an additive filter used by the accruals page.
router.get('/api/gl/accruals', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  const subsidiary = (query.get('subsidiary') ?? '').trim().toUpperCase();
  const status = (query.get('status') ?? '').trim();
  const period = (query.get('period') ?? '').trim();
  try {
    return json(await fetchAll(accrualsQuery(subsidiary, status, period)));
  } catch (e) {
    return fail(e);
  }
});

// Additive: the balance sheet page model (each account with its latest balance), as the
// Flask UI route computed it. An unknown subsidiary means "all".
router.get('/api/gl/balance-sheet', async ({ req, query }) => {
  const denied = await guard(req);
  if (denied) return denied;
  let subsidiary = (query.get('subsidiary') ?? '').trim().toUpperCase();
  if (!SUBSIDIARIES.includes(subsidiary)) subsidiary = '';
  try {
    const accounts = await fetchAll(accountsQuery(subsidiary));
    const latest = latestBalancePerAccount(await fetchAll(balancesQuery()));
    return json({
      subsidiary: subsidiary || 'all',
      rows: accounts.map((account) => ({ account, balance: latest.get(account.id) ?? null })),
    });
  } catch (e) {
    return fail(e);
  }
});

Deno.serve((req) => router.handle(req, 'meridiangl'));
