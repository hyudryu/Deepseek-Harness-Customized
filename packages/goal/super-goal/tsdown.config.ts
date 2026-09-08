import { defineConfig } from 'tsdown'

/** Build independent bundles for the plugin, browser outlet, and invariant. */
export default defineConfig(['lib/types/index.js', 'lib/types/client.js', 'lib/types/invariant.js'].map(entry => ({
  entry: [entry],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})))
