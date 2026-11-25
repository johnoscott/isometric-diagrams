// The systems pack's catalogue: the drawing format's region kinds (as they were drawn before kinds became data, R1
// S2: the same numbers, roles, label styles, legend rows and CSS), and its node kinds (nodes.ts).

import type { KindCatalog, RegionKind } from '../iso-objects/kinds.ts';
import { NODE_ASSETS } from './nodes.ts';

const FENCE_SWATCH = 'border-color:hsl(38 80% 45%);background:hsl(38 80% 55% / .2)';

/** in this order: the legend's automatic rows follow it (fence, then vm), and so does the kinds' CSS */
export const REGION_KINDS: Record<string, RegionKind> = {
  slab: { shape: 'slab', pad: 1.2, z: [-0.8, 0.35], floor: true, role: 'slab', labelStyle: 'face' },
  pad: { shape: 'block', pad: 0.6, z: [0, 0.2], floor: true, role: 'pad', labelStyle: 'floor' },
  fence: {
    shape: 'walled', pad: 0.7, z: [0, 0.8], floor: false, role: 'fence', labelStyle: 'face',
    legend: { label: 'Fence', swatch: FENCE_SWATCH, box: true, auto: true },
    css: '.fz{fill:var(--fence-text)!important;opacity:1!important}\n',
  },
  vm: {
    shape: 'block', pad: 0.6, z: [0, 0.45], floor: true, role: 'sandbox', labelStyle: 'face',
    legend: { label: 'Sandbox', swatch: 'border-color:hsl(170 35% 40%);background:hsl(170 40% 50% / .2)', box: true, auto: true },
  },
  platform: { shape: 'block', pad: 0.6, z: [0, 0.7], floor: true, role: 'server', labelStyle: 'face-right' },
  cloud: { shape: 'cloud', pad: 0.8, z: [0, 0.2], floor: true, role: 'cloud', labelStyle: 'floor' },
  zone: { shape: 'zone', pad: 0.5, z: [0, 0.005], floor: false, role: 'grey', labelStyle: 'floor' },
  tunnel: {
    shape: 'tunnel', pad: 0, z: [0, 0.8], floor: false, role: 'socket', labelStyle: 'none',
    legend: { label: 'Tailscale tunnel', swatch: 'border-color:hsl(205 70% 50%);border-top-width:9px;opacity:.35', box: false, auto: false },
  },
};

export const systems: KindCatalog = { regions: REGION_KINDS, nodes: NODE_ASSETS, defaultNode: 'block' };
