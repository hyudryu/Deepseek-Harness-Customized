/**
 * Self-contained tsdown config for the project-system-prompt custom plugin
 * client bundle. Emits a closure-factory artifact the browser module loader
 * serves a dynamic plugin: `window.__ModuleLoader__.load({id, factory})`, with
 * the loader module-table runtime (React and the shared UI primitives) resolved
 * through the injected `require` and the plugin's own code bundled inline.
 */
import type { UserConfig } from 'tsdown'

const ID = 'dsh-project-system-prompt'

/** Module-table runtime entries; resolved through the injected require. */
const EXTERNALS = new Set([
  'react',
  'react-dom',
  'react/jsx-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
])

export default {
  name: `${ID}/client`,
  entry: { client: 'src/client/index.ts' },
  // The browser bundle lands next to the node half; the entryFileNames pin
  // keeps it exactly `lib/client.js`, and clean stays off so an existing node
  // half is never erased by a client-only rebuild.
  outDir: 'lib',
  format: ['cjs'],
  platform: 'browser',
  target: 'es2024',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: (specifier: string) => EXTERNALS.has(specifier),
    alwaysBundle: (specifier: string) => !EXTERNALS.has(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: ['production', 'browser', 'import', 'module', 'default'],
    },
  },
  // Inline the Node-idiom defines so a CJS bundle cannot throw on an empty
  // `import.meta` or reference `process.env.NODE_ENV` at runtime.
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
} satisfies UserConfig
