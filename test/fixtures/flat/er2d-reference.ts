// The reference for the 2D layout (test/flat.test.ts): the kit's erScene2D, as the model API plan page draws its ER
// figures (`erScene2D`, from a design kit's model API plan page), kept line for line with its DOM taken
// out: it returns the rects, routes and label spots it would draw, and measures text with the function it is given
// where the page asks getComputedTextLength. Its input is the page's own shape: ENT (cells), PLATES (cell ranges),
// CONNS (a, b, a2/b2 "@N" for a plate, k, t). Not part of the engine; never edited to match it.

/* eslint-disable */
type Rect = { l: number; t: number; r: number; b: number };
type Pt = [number, number];
export interface RefEnt { c: [number, number]; name: string; sub?: string }
export interface RefPlate { i0: number; i1: number; j0: number; j1: number; label: string; sub?: string }
export interface RefConn { a: string; b: string; a2?: string; b2?: string; k: string; t?: string }
export interface RefOut { R: Record<string, Rect>; TITLES: Rect[]; routes: { a: string; b: string; pts: Pt[] }[]; labels: { x: number; y: number; anchor: string }[] }

export function erScene2DRef(ENT: Record<string, RefEnt>, PLATES: RefPlate[], CONNS: RefConn[], measure: (s: string, font: any) => number): RefOut {
  const W = 178, H = 58, GX = 44, GY = 44, PAD = 22, TITLE = 30, CH = 96;
  const ids = Object.keys(ENT);
  const NI = Math.max(...ids.map(k => ENT[k].c[0])) + 1, NJ = Math.max(...ids.map(k => ENT[k].c[1])) + 1;
  const plateOf = (i: number, j: number) => PLATES.findIndex(p => i >= p.i0 && i <= p.i1 && j >= p.j0 && j <= p.j1);
  const exX = new Array(NI + 1).fill(0), exY = new Array(NJ + 1).fill(0);
  for (let j = 0; j < NJ; j++) for (let i = 1; i < NI; i++) {
    const a = plateOf(i - 1, j), b = plateOf(i, j);
    if (a !== b) exX[i] = Math.max(exX[i], (a >= 0 ? PAD : 0) + (b >= 0 ? PAD : 0) + CH - GX);
  }
  for (let i = 0; i < NI; i++) for (let j = 1; j < NJ; j++) {
    const a = plateOf(i, j - 1), b = plateOf(i, j);
    if (a !== b) exY[j] = Math.max(exY[j], (a >= 0 ? PAD + TITLE : 0) + (b >= 0 ? PAD : 0) + CH - GY);
  }
  const bx = (i: number) => { let v = i * (W + GX); for (let k = 1; k <= i; k++) v += exX[k]; return v; };
  const by = (j: number) => { let v = j * (H + GY); for (let k = 1; k <= j; k++) v += exY[k]; return v; };
  const lerp = (f0: (n: number) => number, i0: number, i1: number, i: number) => i1 === i0 ? f0(i0) : f0(i0) + (i - i0) * (f0(i1) - f0(i0)) / (i1 - i0);
  const pos = (i: number, j: number) => { const p = PLATES[plateOf(i, j)]; return p ? [lerp(bx, p.i0, p.i1, i), lerp(by, p.j0, p.j1, j)] : [bx(i), by(j)]; };
  const R: Record<string, Rect> = {}, PANELS: Rect[] = [], TITLES: Rect[] = [];
  PLATES.forEach((p, n) => {
    const r = { l: bx(p.i0) - PAD, r: bx(p.i1) + W + PAD, t: by(p.j0) - PAD, b: by(p.j1) + H + PAD + TITLE };
    R["@" + n] = r;
    const tw = measure(p.label, 'title') + (p.sub ? measure(p.sub, 'titleSub') : 0);
    PANELS.push(r); TITLES.push({ l: r.l + 10, r: r.l + 22 + tw, t: r.b - 30, b: r.b - 6 });
  });
  ids.forEach(id => { const e = ENT[id], [x, y] = pos(...e.c), r = { l: x, t: y, r: x + W, b: y + H }; R[id] = r; });
  const cards = ids.map(id => R[id]);
  const inside = (c: Rect, p: Rect) => c.l >= p.l && c.r <= p.r && c.t >= p.t && c.b <= p.b;
  const borders = (a: Pt, b: Pt) => PANELS.reduce((n, p) => {
    if (a[0] === b[0]) { const lo = Math.min(a[1], b[1]), hi = Math.max(a[1], b[1]); if (a[0] > p.l && a[0] < p.r) n += [p.t, p.b].filter(y => y > lo + 1 && y < hi - 1).length; }
    else { const lo = Math.min(a[0], b[0]), hi = Math.max(a[0], b[0]); if (a[1] > p.t && a[1] < p.b) n += [p.l, p.r].filter(x => x > lo + 1 && x < hi - 1).length; }
    return n; }, 0);
  const nearEdge = (a: Pt, b: Pt) => PANELS.some(p => a[1] === b[1] ? [p.t, p.b].some(y => Math.abs(a[1] - y) < 16 && Math.max(a[0], b[0]) > p.l && Math.min(a[0], b[0]) < p.r)
                                                       : [p.l, p.r].some(x => Math.abs(a[0] - x) < 16 && Math.max(a[1], b[1]) > p.t && Math.min(a[1], b[1]) < p.b));
  const hits = (a: Pt, b: Pt, o: Rect, m: number) => Math.min(a[0], b[0]) < o.r + m && Math.max(a[0], b[0]) > o.l - m && Math.min(a[1], b[1]) < o.b + m && Math.max(a[1], b[1]) > o.t - m;
  const crossesPanel = (a: Pt, b: Pt, A: Rect, B: Rect) => PANELS.filter(p => p !== A && p !== B && !inside(A, p) && !inside(B, p) && hits(a, b, { l: p.l + 3, r: p.r - 3, t: p.t + 3, b: p.b - 3 }, 0)).length;
  const used: [Pt, Pt][] = [];
  const overlapUsed = (a: Pt, b: Pt) => used.filter(([c, d]) => {
    if (a[1] === b[1] && c[1] === d[1] && Math.abs(a[1] - c[1]) < 6) return Math.min(Math.max(a[0], b[0]), Math.max(c[0], d[0])) - Math.max(Math.min(a[0], b[0]), Math.min(c[0], d[0])) > 0;
    if (a[0] === b[0] && c[0] === d[0] && Math.abs(a[0] - c[0]) < 6) return Math.min(Math.max(a[1], b[1]), Math.max(c[1], d[1])) - Math.max(Math.min(a[1], b[1]), Math.min(c[1], d[1])) > 0;
    return false;
  }).length;
  const all = Object.values(R), L0 = Math.min(...all.map(r => r.l)), R0 = Math.max(...all.map(r => r.r)), T0 = Math.min(...all.map(r => r.t)), B0 = Math.max(...all.map(r => r.b));
  const mids = (lo: number, hi: number) => { const v = (lo + hi) / 2; return [v, v - 12, v + 12, v - 24, v + 24]; };
  function lanesY() { const ys: number[] = []; cards.forEach(a => cards.forEach(b => { if (b.t > a.b && b.l < a.r + 400 && b.r > a.l - 400) ys.push(...mids(a.b, b.t)); })); ys.push(T0 - 22, T0 - 34, B0 + 22, B0 + 34); return [...new Set(ys.map(Math.round))]; }
  function lanesX() { const xs: number[] = []; cards.forEach(a => cards.forEach(b => { if (b.l > a.r) xs.push(...mids(a.r, b.l)); })); xs.push(L0 - 22, L0 - 34, R0 + 22, R0 + 34); return [...new Set(xs.map(Math.round))]; }
  const LY = lanesY(), LX = lanesX();
  function cost(pts: Pt[], skip: Rect[]) {
    let len = 0, bad = 0, ov = 0;
    for (let k = 1; k < pts.length; k++) {
      const a = pts[k - 1], b = pts[k]; len += Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
      cards.forEach(o => { if (!skip.includes(o) && hits(a, b, o, 6)) bad++; });
      TITLES.forEach(o => { if (hits(a, b, o, 2)) bad++; });
      ov += overlapUsed(a, b) + 0.75 * crossesPanel(a, b, skip[0], skip[1]) + 0.3 * borders(a, b);
      if (nearEdge(a, b)) ov += 0.5;
    }
    return bad ? Infinity : len + 70 * (pts.length - 2) + 400 * ov;
  }
  const cx = (r: Rect) => (r.l + r.r) / 2, cy = (r: Rect) => (r.t + r.b) / 2;
  function routes(A: Rect, B: Rect) {
    const out: Pt[][] = [], oxs = [0, -22, 22, -44, 44];
    const ol = Math.max(A.l, B.l), orr = Math.min(A.r, B.r);
    if (orr - ol > 24) for (const d of oxs) { const x = (ol + orr) / 2 + d; if (x > ol + 8 && x < orr - 8) out.push(B.t >= A.b ? [[x, A.b], [x, B.t]] : [[x, A.t], [x, B.b]]); }
    const ot = Math.max(A.t, B.t), ob = Math.min(A.b, B.b);
    if (ob - ot > 16) for (const d of [0, -10, 10]) { const y = (ot + ob) / 2 + d; out.push(B.l >= A.r ? [[A.r, y], [B.l, y]] : [[A.l, y], [B.r, y]]); }
    for (const da of oxs) for (const db of oxs) {
      const ax = cx(A) + da, bxx = cx(B) + db, ay = cy(A) + da / 3, byy = cy(B) + db / 3;
      for (const y of LY) {
        const ya = y > A.b ? A.b : y < A.t ? A.t : null, yb = y > B.b ? B.b : y < B.t ? B.t : null;
        if (ya !== null && yb !== null) out.push([[ax, ya], [ax, y], [bxx, y], [bxx, yb]]);
      }
      for (const x of LX) {
        const xa = x > A.r ? A.r : x < A.l ? A.l : null, xb = x > B.r ? B.r : x < B.l ? B.l : null;
        if (xa !== null && xb !== null) out.push([[xa, ay], [x, ay], [x, byy], [xb, byy]]);
      }
      if (da === 0 && db === 0) for (const x of LX) for (const y of LY) {
        const xa = x > A.r ? A.r : x < A.l ? A.l : null, yb = y > B.b ? B.b : y < B.t ? B.t : null;
        if (xa !== null && yb !== null) out.push([[xa, ay], [x, ay], [x, y], [bxx, y], [bxx, yb]]);
        const ya = y > A.b ? A.b : y < A.t ? A.t : null, xb = x > B.r ? B.r : x < B.l ? B.l : null;
        if (ya !== null && xb !== null) out.push([[ax, ya], [ax, y], [x, y], [x, byy], [xb, byy]]);
      }
      const xb2 = cx(A) < B.l ? B.l : cx(A) > B.r ? B.r : null, yA = byy < A.t ? A.t : byy > A.b ? A.b : null;
      if (xb2 !== null && yA !== null) out.push([[ax, yA], [ax, byy], [xb2, byy]]);
      const yb2 = cy(A) < B.t ? B.t : cy(A) > B.b ? B.b : null, xA = bxx < A.l ? A.l : bxx > A.r ? A.r : null;
      if (yb2 !== null && xA !== null) out.push([[xA, ay], [bxx, ay], [bxx, yb2]]);
    }
    return out;
  }
  const labs: Rect[] = [];
  const onBorder = (q: Rect) => PANELS.some(p => [p.l, p.r].some(x => q.l < x + 3 && q.r > x - 3 && q.b > p.t && q.t < p.b) || [p.t, p.b].some(y => q.t < y + 3 && q.b > y - 3 && q.r > p.l && q.l < p.r));
  const onLine = (q: Rect) => used.filter(([a, b]) => hits(a, b, q, 1)).length;
  const boxBad = (q: Rect) => 3 * onLine(q) + (onBorder(q) ? 1 : 0) + (TITLES.some(o => q.l < o.r && q.r > o.l && q.t < o.b && q.b > o.t) ? 5 : 0)
    + 5 * cards.filter(o => q.l < o.r + 3 && q.r > o.l - 3 && q.t < o.b + 3 && q.b > o.t - 3).length
    + 5 * labs.filter(o => q.l < o.r + 4 && q.r > o.l - 4 && q.t < o.b + 2 && q.b > o.t - 2).length;
  const boxHits = (q: Rect) => onLine(q) || onBorder(q) || TITLES.some(o => q.l < o.r && q.r > o.l && q.t < o.b && q.b > o.t) || cards.some(o => q.l < o.r + 3 && q.r > o.l - 3 && q.t < o.b + 3 && q.b > o.t - 3) || labs.some(o => q.l < o.r + 4 && q.r > o.l - 4 && q.t < o.b + 2 && q.b > o.t - 2);
  const out: RefOut = { R, TITLES, routes: [], labels: [] };
  CONNS.forEach(c => {
    const A = R[c.a2 || c.a], B = R[c.b2 || c.b]; if (!A || !B || A === B) return;
    let best: Pt[] | null = null, bc = Infinity;
    for (const p of routes(A, B)) { const k = cost(p, [A, B]); if (k < bc) { bc = k; best = p; } }
    if (!best) return;
    for (let k = 1; k < best.length; k++) used.push([best[k - 1], best[k]]);
    out.routes.push({ a: c.a, b: c.b, pts: best });
    if (!c.t) return;
    const segs: [Pt, Pt][] = []; for (let k = 1; k < best.length; k++) segs.push([best[k - 1], best[k]]);
    segs.sort((p, q) => (Math.abs(q[0][0] - q[1][0]) + Math.abs(q[0][1] - q[1][1])) - (Math.abs(p[0][0] - p[1][0]) + Math.abs(p[0][1] - p[1][1])));
    const w = measure(c.t, 'label') + 6;
    let placed: [number, number, string, Rect] | null = null, least: [number, number, string, Rect] | null = null, leastBad = Infinity;
    for (const [a, b] of segs) {
      const mx = (a[0] + b[0]) / 2, my2 = (a[1] + b[1]) / 2;
      const tries: [number, number, string][] = a[1] === b[1]
        ? [0, -0.3, 0.3, -0.15, 0.15].flatMap(k => { const x = mx + k * Math.abs(a[0] - b[0]); return [[x, my2 - 6, "middle"], [x, my2 + 15, "middle"]] as [number, number, string][]; })
        : [0, -0.3, 0.3].flatMap(k => { const y = my2 + 4 + k * Math.abs(a[1] - b[1]); return [[mx + 7, y, "start"], [mx - 7, y, "end"], [mx + 24, y, "start"], [mx - 24, y, "end"]] as [number, number, string][]; });
      for (const [x, y, an] of tries) {
        const l = an === "middle" ? x - w / 2 : an === "end" ? x - w : x, q = { l, r: l + w, t: y - 11, b: y + 3 };
        if (!boxHits(q)) { placed = [x, y, an, q]; break; }
        const bad = boxBad(q); if (bad < leastBad) { leastBad = bad; least = [x, y, an, q]; }
      }
      if (placed) break;
    }
    if (!placed && least) placed = least;
    if (!placed) { const [a, b] = segs[0]; const x = (a[0] + b[0]) / 2, y = (a[1] + b[1]) / 2 - 6; placed = [x, y, "middle", { l: x - w / 2, r: x + w / 2, t: y - 11, b: y + 3 }]; }
    labs.push(placed[3]);
    out.labels.push({ x: placed[0], y: placed[1], anchor: placed[2] });
  });
  return out;
}
