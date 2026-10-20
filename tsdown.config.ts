import { defineConfig } from 'tsdown'

const lib = defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  outDir: 'lib',
  dts: true,
  sourcemap: true,
  clean: true,
  outExtensions: () => ({ js: '.js', dts: '.d.ts' }),
  deps: {
    neverBundle: [/^@deepseek-ai\//],
  },
})

/**
 * Browser half. The host's client-module scanner loads any bundle that
 * declares `dsh.client` + `exports["./client"]`; the artifact must call
 * `window.__ModuleLoader__.load({ id, factory })` like the harness's own
 * client packages. React and `react/jsx-runtime` stay external and resolve
 * from the loader's module table.
 */
const client = defineConfig({
  entry: { client: 'src/client/index.tsx' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  dts: false,
  clean: false,
  deps: {
    neverBundle: ['@deepseek-ai/cordis', 'react', 'react/jsx-runtime'],
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: 'window.__ModuleLoader__.load({ id: "@goodandready/dsh-opencode-provider", factory: (require) => {',
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
})

export default [lib, client]
