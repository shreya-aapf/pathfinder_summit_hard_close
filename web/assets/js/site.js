// The folder that holds index.html, worked out from this file's own location, so the site
// runs from any URL prefix (for example .../Hard_Close/web/) and not just from a domain root.
export const ROOT = new URL('../../', import.meta.url);

// url('procureos/po.html?n=PO-1') -> absolute URL inside the site.
// A path that ends in "/" (or is empty) points at that folder's index.html.
export function url(path) {
  const clean = String(path).replace(/^\/+/, '');
  const cut = clean.search(/[?#]/);
  let pathname = cut < 0 ? clean : clean.slice(0, cut);
  const rest = cut < 0 ? '' : clean.slice(cut);
  if (pathname === '' || pathname.endsWith('/')) pathname += 'index.html';
  return new URL(pathname + rest, ROOT).href;
}
