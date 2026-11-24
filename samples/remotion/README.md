# A drawing in a Remotion video

A small project of its own: `Story` is a drawing with its motion and a caption, and `Two` is a drawing fading to black and white in a `TransitionSeries`.

    npm install

**Remotion isn't open source, and using it needs Remotion's own licence** (remotion.dev/license). The engine is MIT; Remotion, and what you render with, are yours to install
and to have a licence for. This project has nothing to render with: add Remotion's command line (`@remotion/cli`, at the same version, 4.0.546), then

    npm run check            # its types, with the command line's beside them
    npx remotion studio ./src/index.ts
    npx remotion render ./src/index.ts Story

- Passing `licenseKey: 'free-license'` makes Remotion report each render to remotion.pro. With no `licenseKey`, Remotion 4 sends nothing. Nothing here passes one.
- The first render downloads a Chrome, unless you give `--browser-executable`.

**The font**: `public/Arimo-wght.ttf` is Arimo (version 1.341, from Google Fonts' `ofl/arimo`, unmodified), under the SIL Open Font License 1.1 in `public/OFL.txt`. Arimo is a trademark of
Google Inc. The engine's package has no font: `font: 'arimo'` lays a drawing out with Arimo's widths, and your project loads the file. Monospaced text has no font chosen: it is the
system's, so it can differ from one computer to another.
