// The pins in a file's data, read-only: KEY.layout.NAME = { at: [x, y] } (the canvas writes them, under the adapter's own key).

/** Each pinned name and where it is, in the file's order; one that isn't a pin is left out. */
export function readPins(data: unknown, key = 'x-editor'): ReadonlyMap<string, readonly [number, number]> {
  const isMap = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const held = isMap(data) && isMap(data[key]) ? (data[key] as Record<string, unknown>).layout : undefined, out = new Map<string, readonly [number, number]>();
  for (const [name, v] of Object.entries(isMap(held) ? held : {})) {
    const at = isMap(v) ? v.at : undefined;
    if (Array.isArray(at) && at.length === 2 && at.every(n => typeof n === 'number' && Number.isFinite(n))) out.set(name, [at[0] as number, at[1] as number]);
  }
  return out;
}
