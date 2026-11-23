// Paths: a node's place in a document, as segments (["nodes","web","size"]) or as a JSON Pointer
// ("/nodes/web/size"), the form ajv, the validators and the canvas's data-path use. Pure.

export type Seg = string | number;
export type Path = Seg[];

const esc = (s: Seg) => String(s).replace(/~/g, '~0').replace(/\//g, '~1');
export const toPointer = (p: Path) => p.map(s => '/' + esc(s)).join('');
export function fromPointer(ptr: string): Path {
  if (!ptr) return [];
  return ptr.split('/').slice(1).map(s => {
    const u = s.replace(/~1/g, '/').replace(/~0/g, '~');
    return /^\d+$/.test(u) ? Number(u) : u;
  });
}
export const parentOf = (p: Path): Path | undefined => (p.length ? p.slice(0, -1) : undefined);
export const isPrefix = (a: Path, b: Path) => a.length <= b.length && a.every((s, i) => String(s) === String(b[i]));
export const samePath = (a: Path, b: Path) => a.length === b.length && isPrefix(a, b);
