# The layers

The engine is four generic layers and one kind pack beside them. Each is a folder under `src/` with an `index.ts`.
`scripts/layers.ts` holds the map, and the tests hold every source to it (`test/layers.test.ts`,
`test/layers-neutral.test.ts`).

| Layer | Folder | Rank | May import |
|---|---|---|---|
| L0 core | `src/iso-core/` | 0 | nothing of the engine |
| L1 objects | `src/iso-objects/` | 1 | L0 |
| P systems | `src/iso-systems/` | 1.5 | L0, L1, and data in `themes/`, `examples/` |
| L2 viewer | `src/iso-viewer/` | 2 | L0, L1 |
| L3 editor | `src/iso-editor/` | 3 | L0, L1, L2 |

The apps (`src/cli/`, `src/proof/`) may use any layer. No layer imports an app, a test or an example.

## The rules

- **Down only.** A layer imports from the layers below it, never from one above or beside it. The generic layers
  (L0–L3) never import the kind pack, though its rank is below some of them: a format is something a host brings.
- **Public modules only.** A layer's public modules are its `index.ts`, every module `index.ts` re-exports from, and
  its `entries` (modules that do work when they load, kept out of the index so that a bundle which never needs them
  never carries them: the schema compiler, the editor's text pane). Importers name the module, not the index: with
  code splitting, a barrel would pull every file it reaches into every bundle that imports it.
- **No domain words** in a generic layer, in prose or in identifiers, in any word form: the layers know regions,
  nodes, routes and steps, not what a host's drawings are about.

## The package

`npm run build-iso` builds `@johnoscott/isometric-engine` into `dist-iso/`:

- three bundles: `/render` (L0–L2), `/editor` (L0–L3) and `/systems` (L0–L2 and P), each exporting one namespace per
  layer (`{ core, objects, viewer, editor }`, or `systems`);
- every layer's sources and public modules as subpaths, for a host that bundles them itself
  (`@johnoscott/isometric-engine/modules/iso-objects/flat.js`), generated from the map;
- the declarations, the assets (the skin, the editor shell's layout, the canvas's marks, a default theme, L3's
  icons), the third-party notices and the editor guide.

`test/dist-iso.test.ts` checks the exports, the declarations against a consumer outside the repo, the tarball's
listing, and that the tarball holds no one else's marks.
