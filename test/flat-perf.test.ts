// The 2D layout's time (0.6.0): a large board within 200 ms in Node (× PERF_BUDGET_FACTOR on CI). In the serial group of the suite, so the time is
// the layout's own and not that of the tests running beside it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutFlat, metricsMeasure } from '../src/iso-objects/flat.ts';
import { bigBoard } from './fixtures/flat/check.ts';

test('a large board (60 cards, 100 links) is laid out within 200 ms (the best of three, warm)', () => {
  const big = bigBoard();
  let ms = Infinity;
  layoutFlat(big, metricsMeasure);
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); layoutFlat(big, metricsMeasure); ms = Math.min(ms, performance.now() - t0); }
  console.log(`# 60 cards, 100 links: ${ms.toFixed(0)} ms`);
  // PERF_BUDGET_FACTOR: a shared CI runner's slack (the workflow sets 5); here 1. A regression past it still fails.
  const factor = Number(process.env.PERF_BUDGET_FACTOR ?? 1) || 1;
  assert.ok(ms < 200 * factor, `${ms.toFixed(0)} ms (budget ${200 * factor} ms)`);
});
