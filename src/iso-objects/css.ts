// The page and SVG styles, from the reference pages. Colours are theme tokens (see theme.ts); nothing here
// names a colour that should change between light and dark, except the fixed artwork of icons and screens.

import { type KindCatalog, kindsCss } from './kinds.ts';
import { markCss } from './assets.ts';

/** The page around a figure (the standalone page only). */
export const PAGE_CSS = `
*{box-sizing:border-box}
html,body{margin:0}
body{background:var(--bg);color:var(--ink);font:15px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased;overflow-x:hidden}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
code{font-size:.92em;background:var(--code-bg);padding:1px 5px;border-radius:5px;overflow-wrap:anywhere}
.wrap{max-width:1180px;margin:0 auto;padding:32px 16px 64px}
header.page{display:flex;flex-wrap:wrap;gap:12px 24px;align-items:flex-end;justify-content:space-between;margin-bottom:8px}
h1{font-size:clamp(24px,4vw,34px);line-height:1.15;margin:0;letter-spacing:-.01em}
.lede{color:var(--muted);max-width:76ch;margin:8px 0 0}
.pills{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:99px;border:1px solid var(--line);color:var(--muted);background:var(--surface)}
.theme{font:inherit;font-size:12px;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:99px;padding:3px 10px;cursor:pointer}
h2{font-size:20px;margin:44px 0 4px;letter-spacing:-.005em;text-wrap:balance}
.sec-sub{color:var(--muted);margin:0 0 14px;font-size:14px;max-width:84ch}
.figure{background:var(--surface);border:1px solid var(--line);border-radius:16px;margin:12px 0 10px;overflow:hidden}
.scroller{overflow-x:auto;-webkit-overflow-scrolling:touch}
.scroller svg{display:block;width:100%;min-width:720px;height:auto}
.legend{display:flex;flex-wrap:wrap;gap:6px 18px;padding:10px 18px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.legend:empty{display:none}
.legend span{display:inline-flex;align-items:center;gap:8px}
.legend i{display:inline-block;width:26px;height:0;border-top:3px solid}
.legend i.box{height:10px;border-width:1.5px;border-style:solid;border-radius:2px}
footer{margin-top:40px;font-size:12.5px;color:var(--muted)}
`;

/** The drawing itself (a page's, and an interactive view's, scoped: src/iso-viewer/view-css.ts). */
/** the drawing's stylesheet; the catalogue's kinds add their own rules (kindsCss) in the middle, as they always sat */
/** the drawing's styles for a catalogue, with the marks a host has registered so far (registerMarks) */
export const drawingCss = (cat: KindCatalog): string => DRAWING_CSS_A + kindsCss(cat) + DRAWING_CSS_B + markCss();
const DRAWING_CSS_A = `
/* blocks: hue per role, lightness per face and theme */
.blk .top{fill:hsl(var(--h) var(--s) var(--l-top))}
.blk .lft{fill:hsl(var(--h) var(--s) var(--l-left))}
.blk .rgt{fill:hsl(var(--h) var(--s) var(--l-right))}
.blk polygon,.blk path.top,.blk path.lft{stroke:hsl(var(--h) var(--s) var(--l-edge));stroke-width:.8;stroke-linejoin:round}
.blk .det{stroke:hsl(var(--h) var(--s) var(--l-edge));stroke-width:1.4;fill:none;stroke-linecap:round;opacity:.7}
.k-slab .top{fill:var(--slab-top)} .k-slab .lft{fill:var(--slab-l)} .k-slab .rgt{fill:var(--slab-r)}
.k-pad .top{fill:var(--pad-top)}
.wall polygon{fill-opacity:.34}
.zone polygon{fill:hsl(var(--h) var(--s) 50% / .12);stroke:hsl(var(--h) var(--s) 45% / .55);stroke-dasharray:5 4;stroke-width:1.2}
.ghost polygon{fill:transparent!important;stroke:var(--muted);stroke-dasharray:4 4;stroke-width:1.2}
.ghost .det{opacity:.45}
.blk polygon.ico-unknown{fill:none;stroke:hsl(var(--h) var(--s) var(--l-edge));stroke-width:1.2;stroke-dasharray:3 2.5}
.blk .ico-unknown-q{stroke:hsl(var(--h) var(--s) var(--l-edge));stroke-width:1.6;stroke-linecap:round;fill:none}
.blk polygon.sock-hole{fill:hsl(var(--h) var(--s) 18%);opacity:.8}
.scr .t{fill:#1d1f27;stroke:#3a3b44;stroke-width:.6}
.scr .ln{stroke:#8fd3b0;stroke-width:1.2;stroke-linecap:round}
.scr .bar{fill:#2a2c36}
.scr .win{fill:#e9e9ee}
.scr .wall{fill:#3b5bbd}
.scr .glass{fill:#0d0e12;stroke:#3a3b44;stroke-width:1}
.scr .w{fill:#f4f4f2}
.scr .d{fill:#0b0b0d}
.scr .m{fill:#3a3934}
.scr .unk{fill:none;stroke:#8a8d99;stroke-width:1;stroke-dasharray:3 2.5}
.scr .unk-q{fill:none;stroke:#8a8d99;stroke-width:1.4;stroke-linecap:round}
.scr .unk-dot{fill:#8a8d99}
.orb .ball{fill:url(#orbG);stroke:#8a8b93;stroke-width:.8}
.orb .shade{fill:#000;opacity:.18}
.orb .eye{fill:#0b0b0d}
.person .body{fill:hsl(var(--h) var(--s) var(--l-left));stroke:hsl(var(--h) var(--s) var(--l-edge));stroke-width:.8}
.person .head{fill:hsl(var(--h) var(--s) var(--l-top));stroke:hsl(var(--h) var(--s) var(--l-edge));stroke-width:.8}

/* text */
.lbl{font-size:13px;font-weight:700;fill:var(--ink);paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.sub{font-size:11px;fill:var(--muted);font-weight:400;paint-order:stroke;stroke:var(--surface);stroke-width:4px;stroke-linejoin:round}
.floor{font-size:11px;font-weight:600;letter-spacing:.01em}
.floor.t-control{fill:var(--muted)}
.slabname{font-size:15px;font-weight:800;fill:var(--muted);letter-spacing:.12em;opacity:.8}
.slabname.sm{font-size:10.5px;letter-spacing:.1em;opacity:1}
`;
const DRAWING_CSS_B = `.tunnel polygon{fill:hsl(205 85% 55% / .17);stroke:hsl(205 75% 45% / .8);stroke-width:1.3;stroke-linejoin:round}
.tunnel .top{fill:hsl(205 85% 65% / .22)}
.tunnel .rib{fill:none;stroke:hsl(205 75% 45% / .5);stroke-width:1}
.tunname{font-size:12px;font-weight:800;letter-spacing:.14em;fill:var(--tunnel-text);paint-order:stroke;stroke:var(--surface);stroke-width:3px;stroke-linejoin:round}

/* flows */
.flow{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}
`;

/** a page's stylesheet: the page's own rules and the drawing's */
export const baseCss = (cat: KindCatalog): string => PAGE_CSS + drawingCss(cat);

/** Step marks and step focus, drawn in the SVG (the page, and the editor's canvas). */
export const MARKS_CSS = `
/* step marks */
.xm circle{fill:var(--surface);stroke:var(--blocked);stroke-width:2.5}
.xm path{stroke:var(--blocked);stroke-width:3;stroke-linecap:round}
.say rect{fill:var(--surface);stroke-width:1.5}
.say text{font-size:12px;font-weight:600}
.badge{cursor:pointer}
.badge circle{fill:var(--c);stroke:var(--surface);stroke-width:2.5}
.badge text{font-size:11.5px;font-weight:800;fill:var(--on);text-anchor:middle;dominant-baseline:central;pointer-events:none}
.tok{stroke:var(--surface);stroke-width:2.5}
.pulse{fill:none;stroke-width:2.5;transform-box:fill-box;transform-origin:center;animation:pulse 1.5s ease-out infinite}
@keyframes pulse{from{transform:scale(.35);opacity:.95}to{transform:scale(1.5);opacity:0}}
.sub{stroke-width:5px}

/* step focus: what a step does not touch dims; things that appear later are hidden */
[data-hl],[data-id],[data-step]{transition:opacity .25s}
svg.focus [data-hl]:not(.hl){opacity:.12}
svg.focus.dim-all [data-dim]:not(.hl){opacity:.14}
svg.focus .badge:not(.on){opacity:.14}
svg.all .badge{opacity:1}
svg.focus.all [data-hl]:not(.hl),svg.focus.all.dim-all [data-dim]:not(.hl){opacity:.9}
svg [data-step]:not(.on),svg.all [data-step]{opacity:0!important;pointer-events:none}
.pre{opacity:0!important;pointer-events:none}
`;

/** The player's controls (the page only). */
export const PLAYER_UI_CSS = `
/* player */
.player{display:flex;align-items:flex-start;gap:10px 14px;padding:12px 16px;border-top:1px solid var(--line);flex-wrap:wrap}
.ctrls{display:flex;gap:6px;flex:none}
.pbtn{font:inherit;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--bg);color:var(--ink);border-radius:99px;padding:6px 14px;cursor:pointer}
.pbtn.icon{padding:6px 11px}
.pbtn:hover{border-color:var(--muted)}
.pbtn:disabled{opacity:.6;cursor:default}
.pbtn.primary{background:var(--ink);color:var(--surface);border-color:var(--ink);min-width:92px;justify-content:center}
.pbtn:focus-visible,.dot:focus-visible,.badge:focus-visible{outline:2px solid var(--send);outline-offset:2px}
.cap{flex:1 1 360px;min-width:0}
.cap-h{font-size:14.5px;font-weight:700;display:flex;align-items:center;gap:8px}
.cap-h .cnt{margin-left:auto;font-weight:500;color:var(--muted);font-size:12px;white-space:nowrap}
.num{flex:none;display:inline-grid;place-items:center;width:22px;height:22px;border-radius:50%;background:var(--c,var(--control));color:var(--on);font-size:11px;font-weight:800}
.cap-t{font-size:13.5px;color:var(--ink);margin:4px 0 0;max-width:92ch;min-height:3.1em}
.cap-c{margin:8px 0 0;background:var(--code-bg);border-radius:8px;padding:7px 10px;font-size:12px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:9.5em;overflow-y:auto;color:var(--ink)}
.cap-c:empty{display:none}
.prog{height:3px;background:var(--line);border-radius:3px;overflow:hidden;margin-top:9px}
.prog i{display:block;height:100%;width:0;background:var(--c,var(--ink))}
.dots{display:flex;gap:5px;flex-wrap:wrap;flex-basis:100%;padding-left:2px;order:4}
.dot{width:10px;height:10px;border-radius:50%;background:var(--line);border:0;padding:0;cursor:pointer}
.dot.on{background:var(--ink)} .dot.done{background:var(--muted)}
details.steps{margin:0 0 8px;font-size:13.5px}
details.steps summary{cursor:pointer;color:var(--muted);font-size:13px}
details.steps ol{margin:8px 0 0;padding-left:22px;max-width:92ch}
details.steps li{margin:6px 0}
details.steps li code{font-size:11.5px}
@media (prefers-reduced-motion:reduce){.pulse{animation:none;opacity:.8}}
@media (max-width:560px){.cap{flex-basis:100%}}
.still .pulse{animation:none;opacity:.85}
.still *,.still *::before{transition:none!important}
.still .prog{display:none}
.still .ctrls,.still .tools{display:none}
.tools{display:flex;gap:6px;flex:none;order:3;margin-left:auto}
.pbtn.small{font-size:12px;padding:4px 11px;font-weight:600;color:var(--muted)}
.pbtn.small[aria-pressed="true"]{color:var(--ink);border-color:var(--muted);background:var(--surface)}`;

/** The floor grid and the assemble intro, in the SVG. */
export const GRID_CSS = `
.grid{display:none;fill:none;stroke:var(--ink);stroke-width:.6;opacity:.16;pointer-events:none}
svg.show-grid .grid{display:inline}
svg.pre-assemble > g:not(.g-anim){opacity:0}
`;

export const PLAYER_CSS = MARKS_CSS + PLAYER_UI_CSS + GRID_CSS;
