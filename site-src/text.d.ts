// files the site's bundle reads as text (esbuild's text loader)
declare module '*.yaml' { const text: string; export default text; }
