import { defineConfig } from 'tsdown'

/** Build independent bundles for the plugin, browser outlet, and invariant. */
export default defineConfig(['index', 'client', 'invariant'].map(entry => ({
  entry: [`lib/types/${entry}.js`],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
