import { corsHeaders, err } from './http.ts';

export interface Ctx {
  req: Request;
  url: URL;
  query: URLSearchParams;
  params: Record<string, string>;
}

export type Handler = (ctx: Ctx) => Promise<Response> | Response;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

// Hosted Edge Functions see the function name as the first path segment; strip it so
// routes are written as "/api/po/:po_number".
export function routePath(url: URL, fnName: string): string {
  const marker = `/${fnName}`;
  const i = url.pathname.indexOf(marker);
  let path = i >= 0 ? url.pathname.slice(i + marker.length) : url.pathname;
  if (!path.startsWith('/')) path = '/' + path;
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): this {
    const keys: string[] = [];
    const source = pattern.replace(/:([A-Za-z_]+)/g, (_m, key) => {
      keys.push(key);
      return '([^/]+)';
    });
    this.routes.push({ method, re: new RegExp(`^${source}$`), keys, handler });
    return this;
  }

  get = (p: string, h: Handler) => this.add('GET', p, h);
  post = (p: string, h: Handler) => this.add('POST', p, h);
  put = (p: string, h: Handler) => this.add('PUT', p, h);
  patch = (p: string, h: Handler) => this.add('PATCH', p, h);
  delete = (p: string, h: Handler) => this.add('DELETE', p, h);

  async handle(req: Request, fnName: string): Promise<Response> {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
    const url = new URL(req.url);
    const path = routePath(url, fnName);

    let pathMatched = false;
    for (const route of this.routes) {
      const m = route.re.exec(path);
      if (!m) continue;
      pathMatched = true;
      if (route.method !== req.method) continue;
      const params: Record<string, string> = {};
      route.keys.forEach((key, i) => (params[key] = decodeURIComponent(m[i + 1])));
      try {
        return await route.handler({ req, url, query: url.searchParams, params });
      } catch (e) {
        console.error(`${req.method} ${path} failed:`, e);
        return err('Internal server error', 500);
      }
    }
    return pathMatched ? err('Method not allowed', 405) : err('Not found', 404);
  }
}
