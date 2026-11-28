// (0.30.0) Pins that put things where they are meant to stand. A pin is where a layout places a thing from, which needn't be where
// it then stands (a container that shifts what it holds to fit it, a box rounded to the grid): laid out, each pinned thing is
// measured, and its pin corrected by how far it stands from where it was meant to, until none is off (three tries). Pure.

export type Pin = [string, [number, number]];

/** `want`: each name and where it is meant to stand (as `at` measures it); `lay`: a drawing from pins; `at`: where a drawing stands a
 *  name; `drawn`: the drawing `want` already makes, if laid out. The corrected pins, in `want`'s order, and the drawing they make */
export function settlePins<D>(want: readonly Pin[], lay: (pins: Pin[]) => D, at: (d: D, name: string) => [number, number] | undefined,
  drawn: D = lay(want as Pin[])): { pins: Pin[]; drawn: D } {
  let pins = want as Pin[];
  for (let i = 0; i < 3; i++) {
    let off = 0;
    pins = pins.map(([n, a], k) => {
      const now = at(drawn, n), e = now ? now.map((v, j) => v - want[k]![1][j]!) : [0, 0];
      if (Math.hypot(e[0]!, e[1]!) < 1e-6) return [n, a];
      off = 1;
      return [n, a.map((v, j) => +(v - e[j]!).toFixed(3)) as [number, number]];
    });
    if (!off) break;
    drawn = lay(pins);
  }
  return { pins, drawn };
}

/** (0.30.0) The kept pins a drop needs: each tried without, and left out when the drawing stays the same without it (where
 *  everything stands, as `where` says); what stays is the fewest pins that hold the drawing as the full set does. */
export function prunePins<D>(pins: readonly Pin[], keep: readonly Pin[], lay: (pins: Pin[]) => D, where: (d: D) => string): Pin[] {
  const full = where(lay([...pins, ...keep]));
  return keep.reduce((left, k) => { const rest = left.filter(x => x != k); return where(lay([...pins, ...rest])) == full ? rest : left; }, [...keep]);
}
