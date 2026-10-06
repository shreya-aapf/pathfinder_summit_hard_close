import { createClient } from 'npm:@supabase/supabase-js@2';

// Edge Functions get SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY injected by the platform.
// The service role bypasses row-level security, so tables can be closed to the anon key.
export const db = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);
