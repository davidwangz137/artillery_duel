// Ambient stub for the bare `three` module specifier.
//
// index.html loads three.js from a CDN via an import map:
//   { "imports": { "three": "https://unpkg.com/three@0.160.0/build/three.module.js" } }
// The language server can't follow that URL, so without this stub every
// `import ... from 'three'` errors with "Cannot find module 'three'".
//
// Declaring the module as `any` silences that error and keeps cross-file
// reference resolution working, at the cost of three's API types. For real
// types (autocomplete on THREE.*, type-checking three API calls):
//   npm i -D three @types/three
// then delete this file.
declare module 'three';
