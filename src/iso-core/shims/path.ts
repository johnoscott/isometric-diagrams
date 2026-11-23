// node:path for the browser build (the build maps it here): the posix functions the readers use to resolve the files a
// file extends, on paths inside the folder the person chose (the browser-only mode resolves them with these).
export const sep = '/';
export function isAbsolute(p: string) { return p.startsWith('/'); }
export function normalize(p: string) {
  const abs = p.startsWith('/');
  const out: string[] = [];
  for (const s of p.split('/')) { if (!s || s === '.') continue; if (s === '..') { if (out.length && out[out.length - 1] !== '..') out.pop(); else if (!abs) out.push('..'); } else out.push(s); }
  return (abs ? '/' : '') + out.join('/') || (abs ? '/' : '.');
}
export function resolve(...parts: string[]) {
  let p = '';
  for (const x of parts) p = x.startsWith('/') ? x : p ? `${p}/${x}` : x;
  return normalize(p.startsWith('/') ? p : '/' + p);
}
export function dirname(p: string) { const i = p.replace(/\/+$/, '').lastIndexOf('/'); return i <= 0 ? (p.startsWith('/') ? '/' : '.') : p.slice(0, i); }
export function basename(p: string) { return p.replace(/\/+$/, '').split('/').pop() ?? ''; }
export function join(...parts: string[]) { return normalize(parts.join('/')); }
export function relative(from: string, to: string) {
  const a = normalize(from).split('/').filter(Boolean), b = normalize(to).split('/').filter(Boolean);
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return [...a.slice(i).map(() => '..'), ...b.slice(i)].join('/');
}
export default { sep, isAbsolute, normalize, resolve, dirname, basename, join, relative };
