// Ambient declarations so `tsc` accepts the CSS side-effect imports Vite
// handles at build time. Mirrors the frontend's vite-env.d.ts intent for
// this standalone prototype entry.
declare module '*.css';
