import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'

const require = createRequire(import.meta.url)
const code = readFileSync('lib/client.js', 'utf8')
const registrations = []
let loaded

const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  window: {
    __ModuleLoader__: {
      load: ({ id, factory }) => {
        loaded = { id, exports: factory(require) }
      },
    },
  },
}
vm.runInNewContext(code, sandbox)

if (loaded === undefined) throw new Error('client bundle did not call the module loader')
const slots = {
  inject: (_name, callback) => { callback(); return () => {} },
  register: (options) => { registrations.push(options.name); return () => {} },
}
const ctx = {
  effect: (factory) => { factory(); return () => {} },
  locale: {
    register: () => () => {},
    bind: () => (key) => key,
  },
  slots,
  inject: (_services, callback) => { callback({ slots }) },
  get: () => undefined,
}

loaded.exports.apply(ctx)
console.log(JSON.stringify({ id: loaded.id, exports: Object.keys(loaded.exports), registrations }))
