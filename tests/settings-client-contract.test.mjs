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
  const instrumentedSource = source.replace(
    'const embeddingDimensionRules = {',
    'const embeddingDimensionRules = globalThis.__embeddingDimensionRules = {',
  )
  vm.runInNewContext(instrumentedSource, context)

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
  assert.equal(typeof controller?.saveRetrievalPolicy, 'function')
  assert.equal(typeof controller?.requestCollectionDiscovery, 'function')
  assert.equal(typeof controller?.configureSemantic, 'function')
  assert.match(source, /Search capabilities/)
  assert.match(source, /Enable semantic search/)
  assert.match(source, /Advanced settings/)
  const { EMBEDDING_PROVIDER_CATALOG } = await import('../embedding-models.mjs')
  for (const [provider, definition] of Object.entries(EMBEDDING_PROVIDER_CATALOG)) {
    assert.match(source, new RegExp(`\\b${provider}: \\{`))
    assert.match(source, new RegExp(definition.label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    for (const model of Object.keys(definition.models)) {
      assert.equal(source.includes(model), true, `client catalog is missing ${provider}/${model}`)
    }
  }
  const expectedClientRules = Object.fromEntries(Object.values(EMBEDDING_PROVIDER_CATALOG).flatMap((provider) => Object.entries(provider.models).map(([model, definition]) => {
    const dimensions = definition.dimensions
    const rule = dimensions.kind === 'range'
      ? { minimum: dimensions.minimum, maximum: dimensions.maximum }
      : { values: dimensions.kind === 'fixed' ? [dimensions.dimension] : dimensions.values }
    return [model, rule]
  })))
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.globalThis.__embeddingDimensionRules)),
    expectedClientRules,
  )
  assert.match(source, /Only dimensions supported by the selected model can be chosen/)
  assert.doesNotMatch(source, /1\. Milvus deployment/)
  assert.doesNotMatch(source, /2\. Embedding provider/)
  assert.doesNotMatch(source, /3\. Dense retrieval binding/)
  assert.doesNotMatch(source, /4\. Hybrid defaults/)
  assert.equal(controller?.getSnapshot(), controller?.getSnapshot())
})
