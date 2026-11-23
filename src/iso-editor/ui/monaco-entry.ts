// The portable build's Monaco: one ES module (monaco/monaco.js), the editor trimmed to what the text pane uses (the
// build's lean-monaco) with the YAML grammar. The editor's bundle imports it from beside it.
// @ts-ignore no d.ts for this path
export * from 'monaco-editor/editor/editor.main.js';
// @ts-ignore registers the YAML grammar
import 'monaco-editor/languages/definitions/yaml/register.js';
