import { hmacHex } from './auth.ts';

// Best-effort signed POST to WEBHOOK_URL (a no-op when unset). Awaited with a short timeout
// because the platform may stop work once the response has been returned.
export async function sendWebhook(
  source: string,
  event: string,
  data: Record<string, unknown>,
  signedUrl?: (path: string) => Promise<string | null>,
): Promise<void> {
  const url = (Deno.env.get('WEBHOOK_URL') ?? '').trim();
  if (!url) return;
  const secret = Deno.env.get('WEBHOOK_SECRET') ?? '';

  const payloadData: Record<string, unknown> = { ...data };
  if (signedUrl) {
    const path = payloadData.document_path;
    try {
      payloadData.document_url = typeof path === 'string' && path ? await signedUrl(path) : null;
    } catch {
      payloadData.document_url = null;
    }
  }

  const body = JSON.stringify({ event, source, occurred_at: new Date().toISOString(), data: payloadData });
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Webhook-Event': event };
  if (secret) headers['X-Webhook-Signature'] = `sha256=${await hmacHex(secret, body)}`;

  try {
    const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(3000) });
    await res.body?.cancel();
  } catch (e) {
    console.warn(`Webhook ${event} to ${url} failed:`, e);
  }
}
