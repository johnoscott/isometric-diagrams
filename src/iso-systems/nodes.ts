// The systems pack's node kinds: the drawing format's asset library. Each says its default size and colour role, how
// to draw itself in a box, where its label and pulse go. Adding one: write it here and add it to NODE_ASSETS. The
// factories and the NodeAsset shape are iso-objects' (src/iso-objects/assets.ts).

import { type Mat, type P3, iso, tag, S, center } from '../iso-core/kernel.ts';
import * as D from '../iso-core/glyphs.ts';
import { type NodeAsset, boxAsset, plate, drawCloud, facePainter } from '../iso-objects/assets.ts';

/**
 * A drum: data that outlives what uses it (a Docker-style volume, a room's history, an archive). Its visible side is
 * split where the shading changes, so it shades like a block; two bands mark it as storage.
 */
const volume: NodeAsset = {
  name: 'volume', description: 'Stored data that is kept: a drum with two bands (a volume, a room\'s history, an archive).',
  size: [1.8, 1.8, 1.3], role: 'folder',
  draw(k, b) {
    const [cx, cy] = center(b), r = Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2;
    const at = (deg: number, z: number): P3 => [cx + r * Math.cos(deg * Math.PI / 180), cy + r * Math.sin(deg * Math.PI / 180), z];
    const arc = (a0: number, a1: number, z: number) => Array.from({ length: 13 }, (_, i) => at(a0 + (a1 - a0) * i / 12, z));
    // the visible side runs from the right silhouette (-45°) through the front (45°) to the left one (135°)
    const side = (a0: number, a1: number, cls: string) => k.poly([...arc(a0, a1, b.z0), ...arc(a0, a1, b.z1).reverse()], cls);
    const h = b.z1 - b.z0;
    const band = (z: number) => arc(-45, 135, z).slice(1).map((p, i, all) => k.line3(i ? all[i - 1] : at(-45, z), p, 'det')).join('');
    return side(45, 135, 'lft') + side(-45, 45, 'rgt') + band(b.z0 + h * 0.36) + band(b.z0 + h * 0.68)
      + k.poly(Array.from({ length: 32 }, (_, i) => at(i * 360 / 32, b.z1)), 'top');
  },
};

const orb: NodeAsset = {
  name: 'orb', description: 'An agent: a white sphere with two eyes, on a small plate.',
  size: [1.5, 1.5, 1.6], role: 'lead', cls: 'orb',
  draw(k, b) {
    k.def('orbG', tag('radialGradient', { id: 'orbG', cx: '0.36', cy: '0.30', r: '0.80' },
      tag('stop', { offset: '0', style: 'stop-color:#ffffff' }) + tag('stop', { offset: '0.62', style: 'stop-color:#f6f6f4' }) + tag('stop', { offset: '1', style: 'stop-color:#cfd0d6' })));
    const p = plate(b);
    const [px, py] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, p.z1), R = 23, cy = py - R + 3;
    k.bounds.add([px - R, cy - R]); k.bounds.add([px + R, cy + R]);
    const eye = (dx: number, dy: number, w: number, h: number) =>
      tag('rect', { class: 'eye', x: px + dx - w / 2, y: cy + dy - h / 2, width: w, height: h, rx: w / 2, transform: `rotate(-24 ${(px + dx).toFixed(1)} ${(cy + dy).toFixed(1)})` });
    return k.blockFaces(p)
      + tag('ellipse', { class: 'shade', cx: px, cy: py + 1, rx: R * 0.8, ry: R * 0.3 })
      + tag('circle', { class: 'ball', cx: px, cy, r: R })
      + eye(3, -7, 6.4, 13.5) + eye(14, -12, 5.4, 10.5);
  },
  label(b, _n, hasSub) {
    const [X, Y] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0 + 1.95);
    return { x: X, y: Y - 26 + (hasSub ? 0 : 14), anchor: 'middle' };
  },
  pulse: b => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0 + 0.8, 26],
};

const person: NodeAsset = {
  name: 'person', description: 'A human: body and head on a small plate. The label sits to the right.',
  size: [1.5, 1.5, 1.6], role: 'person', cls: 'person',
  draw(k, b) {
    const p = plate(b);
    const [px, py] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, p.z1);
    k.bounds.add([px - 13, py - 50]);
    const r = (v: number) => v.toFixed(1);
    return k.blockFaces(p)
      + tag('path', { class: 'body', d: `M${r(px - 13)},${r(py - 4)} C${r(px - 13)},${r(py - 34)} ${r(px + 13)},${r(py - 34)} ${r(px + 13)},${r(py - 4)} Q${r(px)},${r(py + 4)} ${r(px - 13)},${r(py - 4)}z` })
      + tag('circle', { class: 'head', cx: px, cy: py - 40, r: 10 });
  },
  label(b) {
    const [X, Y] = iso((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0);
    return { x: X + 30, y: Y + 2, anchor: 'start' };
  },
  pulse: b => [(b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, b.z0 + 0.9, 26],
};

/** An upright screen: a thin standing panel; its large face looks toward the front left (+y) unless turned. */
const screen: NodeAsset = {
  name: 'screen', description: 'An upright screen or terminal panel. `face`: terminal, chat, desktop, tiles, or one the host registers. `facing`: turn in degrees.',
  size: [1.64, 0.3, 1.75], role: 'term',
  draw(k, b, n) {
    const [cx, cy] = center(b), HW = (b.x1 - b.x0) / 2, PH = b.z1 - b.z0, T = 0.14;
    const t = (n.facing ?? 0) * Math.PI / 180, tx = Math.cos(t), ty = Math.sin(t), nx = Math.sin(t) * T, ny = -Math.cos(t) * T;
    const a: [number, number] = [cx - tx * HW, cy - ty * HW], bb: [number, number] = [cx + tx * HW, cy + ty * HW];
    const z0 = b.z0, z1 = b.z1;
    let s = k.poly([[bb[0], bb[1], z0], [bb[0] + nx, bb[1] + ny, z0], [bb[0] + nx, bb[1] + ny, z1], [bb[0], bb[1], z1]], 'rgt')
      + k.poly([[a[0], a[1], z1], [bb[0], bb[1], z1], [bb[0] + nx, bb[1] + ny, z1], [a[0] + nx, a[1] + ny, z1]], 'top')
      + k.poly([[a[0], a[1], z0], [bb[0], bb[1], z0], [bb[0], bb[1], z1], [a[0], a[1], z1]], 'lft');
    const A = iso(a[0], a[1], z1), B = iso(bb[0], bb[1], z1), w = 2 * HW * S, h = PH * S;
    const m: Mat = [(B[0] - A[0]) / w, (B[1] - A[1]) / w, 0, 1, A[0], A[1]];
    const face = facePainter(n.face ?? 'terminal') ?? D.placeholderFace;
    s += k.onMatrix(m, w, h, (W, H) => D.screenGlass(W, H) + face(W, H), 'scr');
    return s;
  },
};

/** A big block with the screen face on its front-left side: a desktop or a session window. */
const monitor: NodeAsset = {
  name: 'monitor', description: 'A block with a screen painted on its front-left face. `face` as for screen.',
  size: [2.4, 0.8, 1.8], role: 'term',
  draw(k, b, n) {
    const face = facePainter(n.face ?? 'terminal') ?? D.placeholderFace;
    return k.blockFaces(b) + k.onFace(b, 'left', (w, h) => D.screenGlass(w, h) + face(w, h), 'scr');
  },
};

const cloud: NodeAsset = {
  name: 'cloud', description: 'A cloud lying on the floor: the internet, or a hosted service.',
  size: [3, 2.4, 0.3], role: 'cloud',
  draw: (k, b) => drawCloud(k, b),
};

export const NODE_ASSETS: Record<string, NodeAsset> = {
  block: boxAsset('block', 'A box. Size and colour role are free; add decorations with `deco`.', [2.4, 2.4, 1.6], 'grey'),
  session: boxAsset('session', 'An agent session: a box with terminal lines (`deco: [terminal: 4]`; add an icon the host registers with `icon: NAME`).', [2.6, 2.6, 1.8], 'work', [{ terminal: 4 }]),
  terminal: boxAsset('terminal', 'A box with terminal lines on its front.', [1.6, 1.2, 0.8], 'term', [{ terminal: 2 }]),
  server: boxAsset('server', 'A service or daemon: a low box with two terminal lines.', [3, 2.2, 0.9], 'doz', [{ terminal: 2 }]),
  chat: boxAsset('chat', 'A chat server or room: a box with a chat bubble on top.', [3.6, 4.4, 1.3], 'chat', ['bubble']),
  mailbox: boxAsset('mailbox', 'A room or inbox: terminal lines and an envelope on top.', [2.4, 2.4, 1.6], 'mail', [{ terminal: 3 }, 'envelope']),
  file: boxAsset('file', 'A file or document: a low box with lines on top.', [1.6, 1.6, 0.6], 'file', ['file-lines']),
  folder: boxAsset('folder', 'A folder or directory: a flat box.', [1.6, 1.6, 0.5], 'folder'),
  key: boxAsset('key', 'A secret: a low box with a key on top.', [1.6, 1.6, 0.6], 'key', [], (k, b) => D.keyGlyph(k, b)),
  socket: boxAsset('socket', 'A socket: a small box with a round opening on top.', [1.2, 1.2, 0.5], 'socket', [], (k, b) => D.socketGlyph(k, b)),
  gate: boxAsset('gate', 'A gate or proxy: a narrow upright slab, usually set in a fence wall.', [0.3, 2, 1.1], 'gate'),
  placeholder: boxAsset('placeholder', 'A placeholder value: a small low box with lines.', [1.2, 1.0, 0.45], 'placeholder', ['file-lines']),
  orb, person, screen, monitor, cloud, volume,
};

export function getAsset(name: string | undefined): NodeAsset | undefined {
  return NODE_ASSETS[name ?? 'block'];
}

