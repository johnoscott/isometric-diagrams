// The Remotion components (src/remotion/index.ts), mounted with react-dom under Remotion's own contexts and hooks, at any frame. Not
// rendered by Remotion's renderer: that is the host's own. They mount through Remotion's Internals (there is no public way without its
// player), and remotion is pinned exactly: a Remotion update may break these tests without breaking users, and the fix is in this harness
// (here, and test/adapters/remotion-page.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { parse } from 'yaml';
import { createElement as h, type ComponentType, type ReactNode } from 'react';
// @ts-ignore its types are another package
import { renderToStaticMarkup } from 'react-dom/server';
import { Internals, Sequence } from 'remotion';
import { IsometricScene, IsometricSequences, isometricPresentation, drawingOf, frameSvg, useIsometricCues, type DrawingProps } from '../src/remotion/index.ts';
import type { MotionDoc } from '../src/iso-objects/motion-doc.ts';
import { bundlePage, drivePage } from './adapters/page-driver.ts';
// @ts-ignore plain JS helper
import { chromePath } from '../scripts/chrome.mjs';

let chrome: string | undefined;
try { chrome = chromePath(); } catch { chrome = undefined; }

const read = (f: string) => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const P: DrawingProps = { src: read('test/fixtures/motion/stepped-build.yaml'), theme: read('themes/default.yaml'), motion: parse(read('test/fixtures/motion/stepped-build.motion.yaml')) as MotionDoc };
const D = drawingOf(P);
const I = Internals as unknown as Record<string, { Provider: ComponentType<{ value: unknown; children?: ReactNode }> }> & { VideoProvider: ComponentType<{ children?: ReactNode }> };
/** a composition at a frame, as Remotion gives it to what is in it */
function at(frame: number, el: ReactNode, fps = 30): string {
  const cfg = { fps, width: 1920, height: 1080, durationInFrames: 100000 }, p = (name: string, value: unknown, child: ReactNode) => h(I[name].Provider, { value }, child);
  const manager = { compositions: [{ id: 'x', component: () => null, defaultProps: {}, ...cfg }], folders: [], currentCompositionMetadata: { ...cfg, props: {} }, currentAssetMetadata: null, canvasContent: { type: 'composition', compositionId: 'x' } };
  const timeline = { frame: { x: frame }, playing: false, rootId: 'r', playbackRate: 1, imperativePlaying: { current: false }, setPlaybackRate() {}, audioAndVideoTags: { current: [] } };
  return renderToStaticMarkup(p('CanUseRemotionHooks', true, p('CompositionManager', manager, p('ResolveCompositionContext', {}, h(I.VideoProvider, null, p('TimelineContext', timeline, el))))));
}
const scene = (o: object = {}) => h(IsometricScene, { ...P, prefix: 'q-', ...o });
const svgIn = (html: string) => /<svg[\s\S]*<\/svg>/.exec(html)![0].replace('<svg width="100%" height="100%" ', '<svg ');

test('the scene at a frame is the Timeline\'s, in any order, at any rate of frames', () => {
  for (const f of [1343, 0, 700, 3, 1343]) assert.equal(svgIn(at(f, scene())), frameSvg(D, f, 30, { prefix: 'q-' }));
  assert.equal(svgIn(at(100, scene(), 25)), frameSvg(D, 100, 25, { prefix: 'q-' }));
  assert.equal(svgIn(at(1100, scene({ ambient: 'off' }))), frameSvg(D, 1100, 30, { prefix: 'q-', ambient: 'off' }));
  assert.equal(at(700, scene()), at(700, scene()));
});

test('inside a Sequence it is that Sequence\'s frame: from its start, trimmed, at its rate', () => {
  const seq = (o: object, f: number) => svgIn(at(f, h(Sequence as unknown as ComponentType<Record<string, unknown>>, { layout: 'none', ...o }, scene())));
  assert.equal(seq({ from: 30 }, 75), frameSvg(D, 45, 30, { prefix: 'q-' }));
  assert.equal(seq({ from: -20 }, 75), frameSvg(D, 95, 30, { prefix: 'q-' }));
  // half a frame, in the middle of a fade: the moment between the two
  const half = seq({ from: 0, playbackRate: 0.5 }, 203);
  assert.equal(half, frameSvg(D, 101.5, 30, { prefix: 'q-' })); for (const f of [101, 102]) assert.notEqual(half, frameSvg(D, f, 30, { prefix: 'q-' }));
  assert.equal(at(5, h(Sequence as unknown as ComponentType<Record<string, unknown>>, { layout: 'none', from: 30 }, scene())), '', 'not begun');
});

test('two at once, as a transition has them: no id alike, and each used one is there', () => {
  const html = at(900, h('div', null, h(IsometricScene, P), h(IsometricScene, P)));
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
  assert.ok(ids.length > 1); assert.equal(new Set(ids).size, ids.length);
  for (const m of html.matchAll(/url\(#([^)]+)\)/g)) assert.ok(ids.includes(m[1]), m[1]);
  for (const id of ids) assert.match(id, /^[\w-]+$/);
});

test('size, style and class are the box\'s; the drawing fills it', () => {
  const html = at(0, scene({ width: 800, height: '50%', className: 'mine', style: { background: 'black' } }));
  assert.match(html, /^<div class="mine" style="width:800px;height:50%;background:black"><svg width="100%" height="100%" /);
  assert.match(at(0, scene()), /^<div style="width:100%;height:100%">/);
});

test('cues, and a Sequence for each beat: at every frame, the one that is the Timeline\'s, at its own frame', () => {
  const Cue = () => h('i', null, useIsometricCues(P)?.beat ?? 'none');
  const Here = ({ name }: { name: string }) => h('b', null, name);
  for (let f = 0; f < 1344; f += 13) {
    const want = D.timeline.beatAt(f / 30 * 1000)!.name;
    assert.equal(at(f, h(Cue)), `<i>${want}</i>`);
    assert.equal(at(f, h(IsometricSequences, { ...P, children: b => h(Here, { name: b.name }) })), `<div style="display:contents"><b>${want}</b></div>`, `frame ${f}`);
  }
  // a rate that no beat's start falls on: the frames about each
  const starts = D.timeline.beats.flatMap(b => { const f = b.start / 1000 * 29.97; return [Math.floor(f) - 1, Math.floor(f), Math.ceil(f), Math.ceil(f) + 1]; }).filter(f => f >= 0);
  for (const f of starts) assert.equal(at(f, h(IsometricSequences, { ...P, children: b => h(Here, { name: b.name }) }), 29.97), `<div style="display:contents"><b>${D.timeline.beatAt(f / 29.97 * 1000)!.name}</b></div>`, `frame ${f} of 29.97`);
});

test('in Chrome, one mount moved from frame to frame is at each what a fresh one is; and its props moved too', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const js = (await bundlePage('test/adapters/remotion-page.ts', ['../src/iso-systems/schema.json'])).outputFiles![0].contents;
  await drivePage(chrome!, js, '__rem', async ({ ev, until }) => {
    await until('document.title === "ready"', 'the page');
    const bad = await ev<string[]>(`const m = B.mount(), out = []; for (const [f, o] of [[0, {}], [700, {}], [101.5, {}], [1343, {}], [1100, { ambient: 'off' }], [1100, {}], [1100, { mode: 'dark' }], [1100, { prefix: 'z-' }], [0, {}]]) if (m.show(f, o) !== B.fresh(f, o)) out.push(f + JSON.stringify(o)); return out;`);
    assert.deepEqual(bad, []); assert.deepEqual(await ev('return B.errors;'), []);
    assert.equal(await ev<string>('return B.mount().show(100).match(/<b>(.*?)<.b>/)[1];'), 's2');
  }, '1000,800', { csp: null });
});

test('the document\'s fade as a presentation: the one coming in rises, the one going out leaves or stays', () => {
  const show = (p: ReturnType<typeof isometricPresentation>, presentationDirection: string, presentationProgress: number) =>
    renderToStaticMarkup(h(p.component as ComponentType<object>, { presentationDirection, presentationProgress, presentationDurationInFrames: 12, passedProps: p.props, children: 'x' } as object));
  const op = (html: string) => Number(/opacity:([\d.]+)/.exec(html)![1]);
  for (const f of [0, 0.25, 1]) {
    assert.equal(op(show(isometricPresentation(), 'entering', f)), f); assert.equal(op(show(isometricPresentation(), 'exiting', f)), 1 - f);
    assert.equal(op(show(isometricPresentation({ exiting: 'stay' }), 'exiting', f)), 1);
  }
  assert.equal(op(show(isometricPresentation(), 'entering', 1.2)), 1);
  assert.match(show(isometricPresentation(), 'entering', 0.5), /position:absolute;inset:0/);
  assert.throws(() => isometricPresentation({ exiting: 'spin' as never }), /"fade" or "stay"/);
});

test('in Chrome, with the font loaded, Arimo\'s table is what is drawn: every label as wide as it was laid out', { skip: chrome ? false : 'no Chrome', timeout: 120000 }, async () => {
  const font = readFileSync(new URL('../samples/remotion/public/Arimo-wght.ttf', import.meta.url)).toString('base64');
  const { compile } = await import('../src/iso-systems/compile.ts'), { ARIMO } = await import('../src/iso-core/arimo.ts');
  const scenes = ['examples/demo.yaml', 'examples/gallery.yaml'].flatMap(f => compile(read(f), P.theme, { resolveVars: true, font: ARIMO }).scenes);
  const want = new Map(scenes.flatMap(s => s.rendered.texts.map(t => [t.text, t.w])));
  await drivePage(chrome!, new TextEncoder().encode('window.__x = {}; document.title = "ready";'), '__x', async ({ ev, until }) => {
    await until('document.title === "ready"', 'the page');
    const got = await ev<{ text: string; w: number }[]>(`
      const bytes = Uint8Array.from(atob(${JSON.stringify(font)}), c => c.charCodeAt(0));
      document.fonts.add(await new FontFace('Arimo', bytes, { weight: '400 700' }).load());
      document.body.innerHTML = ${JSON.stringify(scenes.map(s => s.rendered.svg).join(''))};
      await document.fonts.ready;
      return [...document.querySelectorAll('svg text:not([transform]):not([class~="mono"])')].filter(t => t.textContent).map(t => ({ text: t.textContent, w: t.getComputedTextLength() }));`);
    const rows = got.filter(g => want.has(g.text)).map(g => ({ ...g, off: Math.abs(want.get(g.text)! - g.w) / g.w }));
    assert.ok(rows.length > 20, `${rows.length} labels`);
    console.log(`# ${rows.length} labels: worst ${(Math.max(...rows.map(r => r.off)) * 100).toFixed(2)}%`);
    // (kerning is not in a table of letters: what is left is it)
    assert.deepEqual(rows.filter(r => r.off > 0.03).map(r => `${r.text} ${r.off}`), []);
  }, '1200,900', { csp: null });
});

test('a fault is thrown whole, and nothing here reports, renders or has a licence key', () => {
  assert.throws(() => at(0, h(IsometricScene, { ...P, src: 'isodiag: 1\nscenes: []\n' })), /line \d+|no scene|scenes/);
  for (const f of readdirSync(new URL('../src/remotion', import.meta.url))) {
    const code = read(`src/remotion/${f}`);
    assert.doesNotMatch(code, /licenseKey|free-license|@remotion\/|fetch\(|setTimeout|Date\.now|Math\.random|useEffect|useState/, f);
  }
});
