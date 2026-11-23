// v0.4.1: the editor's storage keys that hosts rely on (a stable contract; docs/editor/INTEGRATION.md, "Storage").
// A host's watch view reads and writes them. Renaming one is a breaking change: test/storage-keys.test.ts pins them.
//   view   'text' | 'both' | 'canvas': the view the viewer chose (written when they choose one)
//   live   '1' while Live is on; removed when it goes off
export const PREF = { view: 'view', live: 'live' } as const;
export const VIEWS = ['text', 'both', 'canvas'] as const;
