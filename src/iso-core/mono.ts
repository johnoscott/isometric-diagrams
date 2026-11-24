// Black-and-white (monochrome) palettes, patterns and connector line rhythms, plus
// deterministic mapping from any Theme to a print-ready light or dark MonoLook.

import type { Theme } from './theme.ts';

export type MonoPattern = 'none' | 'hatch' | 'hatch-wide' | 'dots';
export type MonoStep = 0 | 1 | 2 | 3;

export interface MonoFace {
  top: string;
  left: string;
  right: string;
  edge: string;
}

export interface MonoRhythm {
  dash: number[];
  width: number;
}

export interface MonoRoleLook extends MonoFace {
  step: MonoStep;
  pattern: MonoPattern;
}

export interface MonoLook {
  mode: 'light' | 'dark';
  paper: string;
  ink: string;
  roles: Record<string, MonoRoleLook>;
  kinds: Record<string, MonoRhythm>;
  warnings: string[];
}

export interface MonoTable {
  roles?: Record<string, { step?: MonoStep; pattern?: MonoPattern }>;
  kinds?: Record<string, { dash?: number[]; width?: number }>;
}

const deepFreeze = <T>(v: T): T => {
  if (v && typeof v === 'object') {
    Object.freeze(v);
    for (const child of Object.values(v as Record<string, unknown>)) deepFreeze(child);
  }
  return v;
};

/** Fixed L* cutoffs separating steps 0/1, 1/2 and 2/3 from a role's light top face. */
const STEP_THRESHOLDS = [86, 81, 76] as const;

const KIND_ORDER = ['send', 'reply', 'token', 'blocked', 'user', 'event', 'control', 'planned'] as const;

export const MONO = deepFreeze({
  light: {
    paper: '#ffffff',
    ink: '#141414',
    steps: [
      { top: '#f4f4f4', left: '#dcdcdc', right: '#c4c4c4', edge: '#3a3a3a' },
      { top: '#dedede', left: '#bfbfbf', right: '#a2a2a2', edge: '#2e2e2e' },
      { top: '#bcbcbc', left: '#9a9a9a', right: '#7e7e7e', edge: '#222222' },
      { top: '#8f8f8f', left: '#707070', right: '#565656', edge: '#141414' },
    ] as readonly [MonoFace, MonoFace, MonoFace, MonoFace],
  },
  dark: {
    paper: '#161616',
    ink: '#f2f2f2',
    steps: [
      { top: '#2a2a2a', left: '#222222', right: '#1b1b1b', edge: '#b8b8b8' },
      { top: '#454545', left: '#383838', right: '#2c2c2c', edge: '#c8c8c8' },
      { top: '#6a6a6a', left: '#565656', right: '#444444', edge: '#dadada' },
      { top: '#9c9c9c', left: '#808080', right: '#686868', edge: '#141414' },
    ] as readonly [MonoFace, MonoFace, MonoFace, MonoFace],
  },
  patterns: ['none', 'hatch', 'hatch-wide', 'dots'] as readonly MonoPattern[],
  rhythms: [
    { dash: [], width: 2.6 },
    { dash: [9, 4], width: 2.4 },
    { dash: [7, 6], width: 2.4 },
    { dash: [3, 6], width: 2.4 },
    { dash: [1.5, 3.5], width: 2.6 },
    { dash: [10, 3, 2, 3], width: 2.4 },
    { dash: [], width: 1.4 },
    { dash: [7, 6], width: 1.4 },
    { dash: [3, 3], width: 1.6 },
    { dash: [14, 4], width: 1.8 },
  ] as readonly MonoRhythm[],
  kindOrder: KIND_ORDER,
  thresholds: STEP_THRESHOLDS,
  darkWidthAdd: 0.4,
});

const HEX_RE = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
const HSL_RE = /^hsl\(\s*([+-]?(?:\d+\.?\d*|\.\d+))\s+([+-]?(?:\d+\.?\d*|\.\d+))%\s+([+-]?(?:\d+\.?\d*|\.\d+))%\s*\)$/i;

function parseColor(color: string): [number, number, number] {
  if (typeof color !== 'string') throw new Error(`mono: invalid colour "${String(color)}"`);
  const s = color.trim();
  const hex = HEX_RE.exec(s);
  if (hex) {
    const h = hex[1];
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16) / 255,
        parseInt(h[1] + h[1], 16) / 255,
        parseInt(h[2] + h[2], 16) / 255,
      ];
    }
    return [
      parseInt(h.slice(0, 2), 16) / 255,
      parseInt(h.slice(2, 4), 16) / 255,
      parseInt(h.slice(4, 6), 16) / 255,
    ];
  }
  const hsl = HSL_RE.exec(s);
  if (hsl) {
    const h = Number(hsl[1]);
    const sat = Number(hsl[2]);
    const lig = Number(hsl[3]);
    if (!Number.isFinite(h) || sat < 0 || sat > 100 || lig < 0 || lig > 100) {
      throw new Error(`mono: invalid colour "${color}"`);
    }
    const hue = ((h % 360) + 360) % 360;
    const S = sat / 100;
    const L = lig / 100;
    const a = S * Math.min(L, 1 - L);
    const f = (n: number) => {
      const k = (n + hue / 30) % 12;
      return L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    return [f(0), f(8), f(4)];
  }
  throw new Error(`mono: invalid colour "${color}"`);
}

function luminance(color: string): number {
  const [r, g, b] = parseColor(color);
  // IEC 61966-2-1 / WCAG 2.1 sRGB transfer function
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** CIE lightness L* (0 to 100) of a #rgb, #rrggbb or hsl(h s% l%) colour. */
export function greyOf(color: string): number {
  const y = luminance(color);
  return y > 216 / 24389 ? 116 * Math.cbrt(y) - 16 : (24389 / 27) * y;
}

/** WCAG 2.1 contrast ratio between two colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const VALID_PATTERNS = new Set<string>(MONO.patterns);
const FIXED_KIND_INDEX = new Map<string, number>(MONO.kindOrder.map((k, i) => [k, i]));

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const uniqueSorted = (names: readonly string[]) => [...new Set(names)].sort(cmp);
const round2 = (n: number) => Math.round(n * 100) / 100;

function stepFromLightness(lStar: number): MonoStep {
  if (lStar >= STEP_THRESHOLDS[0]) return 0;
  if (lStar >= STEP_THRESHOLDS[1]) return 1;
  if (lStar >= STEP_THRESHOLDS[2]) return 2;
  return 3;
}

function validateOwn(own: MonoTable): void {
  if (own.roles) {
    for (const [name, ov] of Object.entries(own.roles)) {
      if (ov.step !== undefined) {
        if (typeof ov.step !== 'number' || !Number.isInteger(ov.step) || ov.step < 0 || ov.step > 3) {
          throw new Error(`mono: invalid step "${String(ov.step)}" for role "${name}"`);
        }
      }
      if (ov.pattern !== undefined) {
        if (typeof ov.pattern !== 'string' || !VALID_PATTERNS.has(ov.pattern)) {
          throw new Error(`mono: invalid pattern "${String(ov.pattern)}" for role "${name}"`);
        }
      }
    }
  }
  if (own.kinds) {
    for (const [name, ov] of Object.entries(own.kinds)) {
      if (ov.dash !== undefined) {
        if (!Array.isArray(ov.dash) || !ov.dash.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
          throw new Error(`mono: invalid dash "${String(ov.dash)}" for kind "${name}"`);
        }
      }
      if (ov.width !== undefined) {
        if (typeof ov.width !== 'number' || !Number.isFinite(ov.width) || ov.width <= 0) {
          throw new Error(`mono: invalid width "${String(ov.width)}" for kind "${name}"`);
        }
      }
    }
  }
}

/** Map a theme's roles and kinds into deterministic monochrome steps, patterns and line rhythms. */
export function monoOf(
  theme: Theme,
  mode: 'light' | 'dark',
  use?: { roles?: string[]; kinds?: string[] },
  own?: MonoTable,
): MonoLook {
  if (mode !== 'light' && mode !== 'dark') throw new Error(`mono: invalid mode "${String(mode)}"`);
  if (own) validateOwn(own);

  const palette = MONO[mode];
  const warnings: string[] = [];
  const lTop = theme.light['l-top'];

  const roleNames = uniqueSorted(use?.roles ?? Object.keys(theme.roles));
  const stepByRole = new Map<string, MonoStep>();
  const byStep: string[][] = [[], [], [], []];

  for (const name of roleNames) {
    const ovStep = own?.roles?.[name]?.step;
    let step: MonoStep;
    if (ovStep !== undefined) {
      step = ovStep;
    } else {
      const def = theme.roles[name];
      if (!def) throw new Error(`mono: unknown role "${name}"`);
      if (typeof lTop !== 'string') throw new Error('mono: theme.light is missing "l-top"');
      step = stepFromLightness(greyOf(`hsl(${def.h} ${def.s}% ${lTop})`));
    }
    stepByRole.set(name, step);
    byStep[step].push(name);
  }

  const patternByRole = new Map<string, MonoPattern>();
  for (let step = 0; step < byStep.length; step++) {
    const group = byStep[step];
    for (let i = 0; i < group.length; i++) {
      const name = group[i];
      const ovPattern = own?.roles?.[name]?.pattern;
      if (ovPattern !== undefined) {
        patternByRole.set(name, ovPattern);
      } else {
        const idx = i % MONO.patterns.length;
        const pattern = MONO.patterns[idx];
        patternByRole.set(name, pattern);
        if (i >= MONO.patterns.length) {
          const alike = group.slice(0, i).find(r => patternByRole.get(r) === pattern);
          if (alike !== undefined) {
            warnings.push(`role "${name}" wraps on step ${step} to pattern "${pattern}", matching "${alike}"`);
          }
        }
      }
    }
  }

  const roles: Record<string, MonoRoleLook> = {};
  for (const name of roleNames) {
    const step = stepByRole.get(name)!;
    const pattern = patternByRole.get(name)!;
    const face = palette.steps[step];
    roles[name] = {
      step,
      pattern,
      top: face.top,
      left: face.left,
      right: face.right,
      edge: face.edge,
    };
  }

  const kindNames = uniqueSorted(use?.kinds ?? Object.keys(theme.kinds));
  const widthBump = mode === 'dark' ? MONO.darkWidthAdd : 0;
  const kinds: Record<string, MonoRhythm> = {};
  let extraIndex = 0;

  for (const name of kindNames) {
    const ov = own?.kinds?.[name];
    const fixedIdx = FIXED_KIND_INDEX.get(name);
    let rhythmIdx: number;
    if (fixedIdx !== undefined) {
      rhythmIdx = fixedIdx;
    } else {
      rhythmIdx = MONO.kindOrder.length + extraIndex;
      extraIndex++;
      if (rhythmIdx >= MONO.rhythms.length) {
        const wrapped = rhythmIdx % MONO.rhythms.length;
        if (!ov || ov.dash === undefined || ov.width === undefined) {
          warnings.push(`kind "${name}" exceeds the ${MONO.rhythms.length} line rhythms; reusing rhythm ${wrapped}`);
        }
        rhythmIdx = wrapped;
      }
    }
    const base = MONO.rhythms[rhythmIdx];
    const dash = ov?.dash !== undefined ? [...ov.dash] : [...base.dash];
    const width = ov?.width !== undefined ? ov.width : round2(base.width + widthBump);
    kinds[name] = { dash, width };
  }

  return {
    mode,
    paper: palette.paper,
    ink: palette.ink,
    roles,
    kinds,
    warnings,
  };
}
