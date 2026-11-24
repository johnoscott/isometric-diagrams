import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTheme } from '../src/iso-core/theme.ts';
import { MONO, greyOf, contrast, monoOf } from '../src/iso-core/index.ts';
import type { MonoLook, MonoTable, MonoPattern } from '../src/iso-core/index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const defaultTheme = loadTheme(readFileSync(join(ROOT, 'themes/default.yaml'), 'utf8'));

const approx = (actual: number, expected: number, eps = 0.02, msg?: string) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${msg ?? 'approx'}: expected ${expected} ± ${eps}, got ${actual}`);
};

const isNeutralHex = (c: string): boolean => {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  if (!m) return false;
  return m[1].toLowerCase() === m[2].toLowerCase() && m[2].toLowerCase() === m[3].toLowerCase();
};

test('greyOf and contrast: known values and refusals', () => {
  approx(greyOf('#000'), 0, 1e-9, 'black #rgb');
  approx(greyOf('#000000'), 0, 1e-9, 'black #rrggbb');
  approx(greyOf('#fff'), 100, 1e-9, 'white #rgb');
  approx(greyOf('#ffffff'), 100, 1e-9, 'white #rrggbb');
  approx(greyOf('#FFF'), 100, 1e-9, 'uppercase hex');
  approx(greyOf('hsl(0 0% 0%)'), 0, 1e-9, 'hsl black');
  approx(greyOf('hsl(0 0% 100%)'), 100, 1e-9, 'hsl white');
  // sRGB 0.5 -> Y ≈ 0.214041 -> CIE L* ≈ 53.389
  approx(greyOf('hsl(0 0% 50%)'), 53.389, 0.01, 'hsl(0 0% 50%)');
  // Pure blue is much darker perceptually than pure yellow at the same HSL lightness
  assert.ok(greyOf('hsl(60 100% 50%)') > greyOf('hsl(240 100% 50%)') + 50);

  approx(contrast('#ffffff', '#000000'), 21, 1e-9, 'white on black');
  approx(contrast('#000', '#fff'), 21, 1e-9, 'symmetry');
  approx(contrast('#777777', '#ffffff'), 4.48, 0.01, '#777777 on white');
  approx(contrast('#777', '#fff'), 4.48, 0.01, '#777 on #fff');
  approx(contrast('hsl(0 0% 50%)', 'hsl(0 0% 50%)'), 1, 1e-9, 'identical colours');

  const bad = [
    '',
    'red',
    'white',
    '#12',
    '#1234',
    '#12345',
    '#12345678',
    '#gggggg',
    'rgb(0, 0, 0)',
    'hsl(0, 0%, 50%)',
    'hsl(0 0% 50% / 0.5)',
    'hsl(0 0 50)',
    'hsl(0 110% 50%)',
    'hsl(0 0% -5%)',
    'var(--ink)',
  ];
  for (const b of bad) {
    assert.throws(() => greyOf(b), err => err instanceof Error && err.message.includes(b), `greyOf should refuse "${b}"`);
    assert.throws(() => contrast(b, '#fff'), err => err instanceof Error && err.message.includes(b), `contrast(a) should refuse "${b}"`);
    assert.throws(() => contrast('#fff', b), err => err instanceof Error && err.message.includes(b), `contrast(b) should refuse "${b}"`);
  }
});

test('MONO tables: face shading, edge contrast, paper/ink contrast, step ordering, strictly neutral', () => {
  for (const mode of ['light', 'dark'] as const) {
    const pal = MONO[mode];
    assert.ok(isNeutralHex(pal.paper), `${mode} paper is neutral`);
    assert.ok(isNeutralHex(pal.ink), `${mode} ink is neutral`);
    assert.ok(contrast(pal.ink, pal.paper) >= 12, `${mode} ink on paper >= 12 (got ${contrast(pal.ink, pal.paper)})`);
    assert.equal(pal.steps.length, 4);

    for (let i = 0; i < pal.steps.length; i++) {
      const s = pal.steps[i];
      for (const face of ['top', 'left', 'right', 'edge'] as const) {
        assert.ok(isNeutralHex(s[face]), `${mode} step ${i} ${face} (${s[face]}) has r=g=b`);
      }
      // top, left, right strictly darker in that order
      assert.ok(greyOf(s.top) > greyOf(s.left), `${mode} step ${i}: top > left`);
      assert.ok(greyOf(s.left) > greyOf(s.right), `${mode} step ${i}: left > right`);

      // edge against top and left at least 3, and against all three on dark
      assert.ok(contrast(s.edge, s.top) >= 3, `${mode} step ${i}: edge vs top >= 3 (got ${contrast(s.edge, s.top)})`);
      assert.ok(contrast(s.edge, s.left) >= 3, `${mode} step ${i}: edge vs left >= 3 (got ${contrast(s.edge, s.left)})`);
      if (mode === 'dark') {
        assert.ok(contrast(s.edge, s.right) >= 3, `dark step ${i}: edge vs right >= 3 (got ${contrast(s.edge, s.right)})`);
      }

      // ink or paper (the better of the two) on every face at least 4.5
      for (const face of ['top', 'left', 'right'] as const) {
        const best = Math.max(contrast(pal.ink, s[face]), contrast(pal.paper, s[face]));
        assert.ok(best >= 4.5, `${mode} step ${i} ${face}: best of ink/paper >= 4.5 (got ${best})`);
      }

      // steps in order of lightness (light: descending; dark: ascending)
      if (i > 0) {
        const prev = pal.steps[i - 1];
        for (const face of ['top', 'left', 'right'] as const) {
          if (mode === 'light') {
            assert.ok(greyOf(prev[face]) > greyOf(s[face]), `light step ${i - 1} ${face} lighter than step ${i}`);
          } else {
            assert.ok(greyOf(prev[face]) < greyOf(s[face]), `dark step ${i - 1} ${face} darker than step ${i}`);
          }
        }
      }
    }
  }
});

test('MONO is deeply frozen and cannot be mutated', () => {
  assert.ok(Object.isFrozen(MONO));
  assert.throws(() => { (MONO as unknown as Record<string, unknown>).patterns = []; }, TypeError);
  assert.throws(() => { (MONO.patterns as string[]).push('extra'); }, TypeError);
  assert.throws(() => { (MONO.light.steps[0] as { top: string }).top = '#000000'; }, TypeError);
  assert.throws(() => { (MONO.dark.steps as unknown as unknown[]).push({}); }, TypeError);
  assert.throws(() => { MONO.rhythms[1].dash.push(99); }, TypeError);
  assert.throws(() => { (MONO.rhythms[0] as { width: number }).width = 9; }, TypeError);
});

test('default theme: fills at least 3 steps, order-independent, stable steps & patterns, 5th role warns', () => {
  const light = monoOf(defaultTheme, 'light');
  const dark = monoOf(defaultTheme, 'dark');

  const stepsUsed = new Set(Object.values(light.roles).map(r => r.step));
  assert.ok(stepsUsed.size >= 3, `default theme fills >= 3 steps (got ${[...stepsUsed].sort()})`);

  const byStep: string[][] = [[], [], [], []];
  for (const [name, r] of Object.entries(light.roles)) {
    const def = defaultTheme.roles[name];
    const l = greyOf(`hsl(${def.h} ${def.s}% ${defaultTheme.light['l-top']})`).toFixed(2);
    byStep[r.step].push(`${name}(${l})`);
  }
  byStep.forEach((list, s) => console.log(`# default step ${s}: ${list.join(', ')}`));

  // Same step and pattern in light and dark; faces come from the mode's table
  for (const name of Object.keys(defaultTheme.roles)) {
    assert.equal(dark.roles[name].step, light.roles[name].step, `${name}: same step in light and dark`);
    assert.equal(dark.roles[name].pattern, light.roles[name].pattern, `${name}: same pattern in light and dark`);
    assert.deepEqual(
      { top: light.roles[name].top, left: light.roles[name].left, right: light.roles[name].right, edge: light.roles[name].edge },
      MONO.light.steps[light.roles[name].step],
    );
    assert.deepEqual(
      { top: dark.roles[name].top, left: dark.roles[name].left, right: dark.roles[name].right, edge: dark.roles[name].edge },
      MONO.dark.steps[dark.roles[name].step],
    );
  }

  // Same bytes whatever the order of `use`
  const rolesA = ['violet', 'lead', 'key', 'slab', 'work'];
  const rolesB = ['work', 'slab', 'key', 'lead', 'violet'];
  const kindsA = ['planned', 'send', 'custom-b', 'custom-a', 'reply'];
  const kindsB = ['reply', 'custom-a', 'custom-b', 'send', 'planned'];
  assert.equal(
    JSON.stringify(monoOf(defaultTheme, 'light', { roles: rolesA, kinds: kindsA })),
    JSON.stringify(monoOf(defaultTheme, 'light', { roles: rolesB, kinds: kindsB })),
  );

  // Adding a role to `use` changes no other role's step
  const sub1 = monoOf(defaultTheme, 'light', { roles: ['lead', 'work', 'slab'] });
  const sub2 = monoOf(defaultTheme, 'light', { roles: ['lead', 'work', 'slab', 'violet', 'key', 'blue'] });
  for (const r of ['lead', 'work', 'slab']) {
    assert.equal(sub2.roles[r].step, sub1.roles[r].step, `adding roles keeps ${r}'s step`);
  }

  // Adding a role later in the alphabet changes no other role's pattern either
  const sameStepRoles = Object.keys(defaultTheme.roles)
    .filter(r => light.roles[r].step === light.roles.slab.step)
    .sort();
  assert.ok(sameStepRoles.length >= 5, 'need a step with >= 5 roles in default theme');
  const first3 = monoOf(defaultTheme, 'light', { roles: sameStepRoles.slice(0, 3) });
  const first4 = monoOf(defaultTheme, 'light', { roles: sameStepRoles.slice(0, 4) });
  for (const r of sameStepRoles.slice(0, 3)) {
    assert.equal(first4.roles[r].pattern, first3.roles[r].pattern, `adding later role keeps ${r}'s pattern`);
  }
  assert.deepEqual(
    sameStepRoles.slice(0, 4).map(r => first4.roles[r].pattern),
    ['none', 'hatch', 'hatch-wide', 'dots'],
  );
  assert.equal(first4.warnings.length, 0);

  // Fifth role on a step wraps to 'none' and warns, naming both itself and the first
  const five = monoOf(defaultTheme, 'light', { roles: sameStepRoles.slice(0, 5) });
  const fifth = sameStepRoles[4];
  const first = sameStepRoles[0];
  assert.equal(five.roles[fifth].pattern, 'none');
  assert.equal(five.warnings.length, 1);
  assert.ok(five.warnings[0].includes(fifth), `warning names fifth role "${fifth}": ${five.warnings[0]}`);
  assert.ok(five.warnings[0].includes(first), `warning names matched role "${first}": ${five.warnings[0]}`);
});

test('kinds: eight distinct built-in rhythms, dark widths + 0.4, unknown kinds in order, running out warns', () => {
  // No two of all 10 rhythms in MONO are alike
  assert.equal(new Set(MONO.rhythms.map(r => JSON.stringify(r))).size, MONO.rhythms.length);

  const eight = ['send', 'reply', 'token', 'blocked', 'user', 'event', 'control', 'planned'];
  const light = monoOf(defaultTheme, 'light', { roles: [], kinds: eight });
  const dark = monoOf(defaultTheme, 'dark', { roles: [], kinds: eight });

  // No two of the eight alike
  const sigs = new Set(eight.map(k => JSON.stringify(light.kinds[k])));
  assert.equal(sigs.size, 8);
  assert.equal(light.warnings.length, 0);

  // Exact match to MONO.rhythms[0..7] and dark width = light width + 0.4
  for (let i = 0; i < eight.length; i++) {
    const k = eight[i];
    assert.deepEqual(light.kinds[k], MONO.rhythms[i]);
    assert.deepEqual(dark.kinds[k].dash, light.kinds[k].dash);
    assert.equal(dark.kinds[k].width, Math.round((light.kinds[k].width + 0.4) * 100) / 100);
  }

  // Unknown kinds take rhythms 8 and 9 in alphabetical order
  const withTwo = monoOf(defaultTheme, 'light', { roles: [], kinds: ['send', 'zeta', 'alpha'] });
  assert.deepEqual(withTwo.kinds.alpha, MONO.rhythms[8]);
  assert.deepEqual(withTwo.kinds.zeta, MONO.rhythms[9]);
  assert.equal(withTwo.warnings.length, 0);

  // Dark widths also apply to unknown kinds
  const withTwoDark = monoOf(defaultTheme, 'dark', { roles: [], kinds: ['zeta', 'alpha'] });
  assert.equal(withTwoDark.kinds.alpha.width, 2);
  assert.equal(withTwoDark.kinds.zeta.width, 2.2);

  // Third unknown kind runs out of rhythms and warns, naming it
  const overflow = monoOf(defaultTheme, 'light', { roles: [], kinds: ['alpha', 'beta', 'gamma'] });
  assert.equal(overflow.warnings.length, 1);
  assert.ok(overflow.warnings[0].includes('gamma'), `warning names overflow kind: ${overflow.warnings[0]}`);
});

test('own overrides, refusals and JSON round trip', () => {
  const own: MonoTable = {
    roles: {
      lead: { step: 0, pattern: 'dots' satisfies MonoPattern },
      work: { step: 3 },
      slab: { pattern: 'hatch-wide' },
    },
    kinds: {
      send: { dash: [4, 2], width: 3.2 },
      reply: { dash: [2, 2] },
      token: { width: 1.5 },
    },
  };
  const look: MonoLook = monoOf(defaultTheme, 'dark', { roles: ['lead', 'work', 'slab'], kinds: ['send', 'reply', 'token'] }, own);

  assert.equal(look.roles.lead.step, 0);
  assert.equal(look.roles.lead.pattern, 'dots');
  assert.equal(look.roles.lead.top, MONO.dark.steps[0].top);
  assert.equal(look.roles.work.step, 3);
  assert.equal(look.roles.work.top, MONO.dark.steps[3].top);
  assert.equal(look.roles.slab.pattern, 'hatch-wide');

  assert.deepEqual(look.kinds.send, { dash: [4, 2], width: 3.2 });
  assert.deepEqual(look.kinds.reply, { dash: [2, 2], width: 2.8 });
  assert.deepEqual(look.kinds.token, { dash: [7, 6], width: 1.5 });

  // Plain JSON round trip
  assert.deepEqual(JSON.parse(JSON.stringify(look)), look);

  // Refusals: invalid step, pattern, dash, width, unknown role
  assert.throws(
    () => monoOf(defaultTheme, 'light', undefined, { roles: { lead: { step: 4 as never } } }),
    err => err instanceof Error && err.message.includes('4'),
  );
  assert.throws(
    () => monoOf(defaultTheme, 'light', undefined, { roles: { lead: { step: -1 as never } } }),
    err => err instanceof Error && err.message.includes('-1'),
  );
  assert.throws(
    () => monoOf(defaultTheme, 'light', undefined, { roles: { lead: { step: 1.5 as never } } }),
    err => err instanceof Error && err.message.includes('1.5'),
  );
  assert.throws(
    () => monoOf(defaultTheme, 'light', undefined, { roles: { lead: { pattern: 'plaid' as never } } }),
    err => err instanceof Error && err.message.includes('plaid'),
  );
  assert.throws(
    () => monoOf(defaultTheme, 'light', undefined, { kinds: { send: { dash: [-1] } } }),
    err => err instanceof Error && err.message.includes('-1'),
  );
  assert.throws(
    () => monoOf(defaultTheme, 'light', undefined, { kinds: { send: { width: 0 } } }),
    err => err instanceof Error && err.message.includes('0'),
  );
  assert.throws(
    () => monoOf(defaultTheme, 'light', { roles: ['no-such-role'] }),
    err => err instanceof Error && err.message.includes('no-such-role'),
  );
});
