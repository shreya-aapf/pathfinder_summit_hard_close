export const BUCKET = 'documents';
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export class UploadError extends Error {}

// Same rules as werkzeug's secure_filename: ASCII only, whitespace to underscores,
// no path separators, no leading dots or underscores.
export function secureFilename(name: string): string {
  const ascii = name.normalize('NFKD').replace(/[^\x00-\x7F]/g, '');
  return ascii.split(/\s+/).filter(Boolean).join('_').replace(/[^A-Za-z0-9_.-]/g, '').replace(/^[._]+|[._]+$/g, '');
}

// deno-lint-ignore no-explicit-any
export async function uploadDocument(db: any, file: File, folder: string, allowed: string[]): Promise<{ path: string; name: string }> {
  const name = secureFilename(file.name || '');
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
  if (!name || !allowed.includes(ext)) {
    throw new UploadError(`Unsupported file type. Allowed: ${[...allowed].sort().join(', ')}.`);
  }
  if (file.size === 0) throw new UploadError('The uploaded file is empty.');
  if (file.size > MAX_UPLOAD_BYTES) throw new UploadError('The file is larger than the 10 MB limit.');

  const path = `${folder}/${crypto.randomUUID().replace(/-/g, '').slice(0, 8)}_${name}`;
  const { error } = await db.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  return { path, name };
}

// deno-lint-ignore no-explicit-any
export async function removeObject(db: any, path: string): Promise<void> {
  try {
    await db.storage.from(BUCKET).remove([path]);
  } catch {
    // a leftover old file is harmless once the replacement has been stored
  }
}

// deno-lint-ignore no-explicit-any
export async function signedUrl(db: any, path: string, expiresIn = 3600): Promise<string | null> {
  const { data, error } = await db.storage.from(BUCKET).createSignedUrl(path, expiresIn);
  if (error) throw new Error(error.message);
  return data?.signedUrl ?? null;
}

// deno-lint-ignore no-explicit-any
export async function downloadObject(db: any, path: string): Promise<Blob> {
  const { data, error } = await db.storage.from(BUCKET).download(path);
  if (error) throw new Error(error.message);
  return data;
}

// Parse a multipart body and return the named file field, or null.
export async function readFile(req: Request, field: string): Promise<File | null> {
  try {
    const form = await req.formData();
    const value = form.get(field);
    return value instanceof File && value.name ? value : null;
  } catch {
    return null;
  }
}
