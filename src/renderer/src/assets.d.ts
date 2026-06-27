// Ambient declarations for static assets imported in the renderer. Kept as a
// non-module script file so the wildcard module declarations apply globally.
declare module '*.png' {
  const src: string;
  export default src;
}

declare module '*.svg' {
  const src: string;
  export default src;
}
