import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientUrl = new URL('../client.js', import.meta.url)
const packageUrl = new URL('../package.json', import.meta.url)

test('the browser bundle registers its Milvus settings card in the dsh plugin settings slot', async () => {
  let registration
  const [source, manifestSource] = await Promise.all([
    readFile(clientUrl, 'utf8'),
    readFile(packageUrl, 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)
  const context = {
    globalThis: {
      __ModuleLoader__: {
        load(value) {
          registration = value
        },
      },
    },
  }
  vm.runInNewContext(source, context)

  assert.equal(registration.id, manifest.name)
  const plugin = registration.factory((moduleName) => {
    assert.equal(moduleName, 'react')
    return { createElement: () => null, useSyncExternalStore: () => ({}) }
  })
  assert.deepEqual([...plugin.inject], ['slots', 'connection', 'remote', 'settingsScope'])

  let slotName
  let entry
  const boundNamespaces = []
  let credentialInvalidation
  const scope = {
    getSnapshot: () => ({ value: { profiles: [], activeProfileId: '' } }),
    subscribe: () => () => {},
    set: async () => {},
  }
  plugin.apply({
    effect(register) {
      register()
    },
    get(service) {
      assert.equal(service, 'connection')
      return { api: { credentials: { describe: async () => ({ result: { ok: true, value: { credentials: {} } } }) } } }
    },
    settingsScope: {
      bind({ namespace }) {
        boundNamespaces.push(namespace)
        return scope
      },
    },
    remote: {
      $on(event, callback) {
        credentialInvalidation = { event, callback }
        return () => {}
      },
    },
    slots: {
      inject(name, callback) {
        slotName = name
        callback()
      },
      register(options, component) {
        entry = { options, component }
      },
    },
  })

  assert.equal(slotName, 'settings.plugin.item')
  assert.equal(entry?.options.name, 'settings.plugin.item')
  assert.equal(entry?.options.id, 'dsh-milvus')
  assert.equal(entry?.options.key, 'dsh-milvus')
  assert.equal(typeof entry?.component, 'function')
  assert.deepEqual(boundNamespaces, ['dsh-milvus', 'dsh-milvus-status'])
  assert.equal(credentialInvalidation?.event, 'credentials/updated')
  const controller = entry?.options.inject?.().controller
  assert.equal(typeof controller?.writeCredential, 'function')
  assert.equal(controller?.getSnapshot(), controller?.getSnapshot())
})
