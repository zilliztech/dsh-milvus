import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import vm from 'node:vm'

const clientUrl = new URL('../client.js', import.meta.url)

function makeScope(initial) {
  let value = initial
  const listeners = new Set()
  const writes = []
  return {
    getSnapshot: () => ({ value }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    async set(field, next) {
      writes.push({ field, value: next })
      value = { ...value, [field]: next }
      for (const listener of listeners) listener()
    },
    writes,
  }
}

test('the settings card manages profiles while sending a token only to dsh Credentials', async () => {
  const source = await readFile(clientUrl, 'utf8')
  let registration
  vm.runInNewContext(source, {
    globalThis: { __ModuleLoader__: { load(value) { registration = value } } },
  })

  const profileScope = makeScope({ profiles: [], activeProfileId: '' })
  const statusScope = makeScope({ checks: {} })
  const credentialViews = {}
  const credentialWrites = []
  let entry
  const plugin = registration.factory((name) => {
    assert.equal(name, 'react')
    return { createElement: () => null, useSyncExternalStore: () => null }
  })
  plugin.apply({
    effect(register) { register() },
    get() {
      return {
        api: {
          credentials: {
            describe: async ({ refs }) => ({ result: { ok: true, value: { credentials: Object.fromEntries(refs.map((ref) => [ref, credentialViews[ref]])) } } }),
            set: async ({ ref, value }) => {
              credentialWrites.push({ ref, value })
              credentialViews[ref] = { configured: true, writable: true, source: 'file' }
            },
          },
        },
      }
    },
    settingsScope: {
      bind({ namespace }) { return namespace === 'dsh-milvus' ? profileScope : statusScope },
    },
    remote: { $on: () => () => {} },
    slots: {
      inject(_name, callback) { callback() },
      register(_options, component) { entry = { _options, component }; return () => {} },
    },
  })
  const controller = entry._options.inject().controller

  const cloudDraft = {
    id: '',
    name: '',
    kind: 'zilliz-cloud',
    endpoint: 'https://in01-example.cloud.zilliz.com',
    database: '',
    credentialRef: 'DSH_MILVUS_ZILLIZ_CLOUD_TOKEN',
  }

  assert.equal(await controller.writeCredential(cloudDraft, 'secret-that-must-not-enter-settings'), true)
  assert.deepEqual(credentialWrites, [{
    ref: 'DSH_MILVUS_ZILLIZ_CLOUD_TOKEN',
    value: 'secret-that-must-not-enter-settings',
  }])
  assert.equal(controller.getSnapshot().credentials.DSH_MILVUS_ZILLIZ_CLOUD_TOKEN.configured, true)

  const savedCloudProfile = await controller.saveProfile(cloudDraft)

  assert.deepEqual(JSON.parse(JSON.stringify(savedCloudProfile)), {
    id: 'zilliz-cloud',
    name: 'Zilliz Cloud',
    kind: 'zilliz-cloud',
    endpoint: 'https://in01-example.cloud.zilliz.com',
    credentialRef: 'DSH_MILVUS_ZILLIZ_CLOUD_TOKEN',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value)), {
    profiles: [{
      id: 'zilliz-cloud',
      name: 'Zilliz Cloud',
      kind: 'zilliz-cloud',
      endpoint: 'https://in01-example.cloud.zilliz.com',
      credentialRef: 'DSH_MILVUS_ZILLIZ_CLOUD_TOKEN',
    }],
    activeProfileId: 'zilliz-cloud',
  })

  assert.equal(JSON.stringify(profileScope.getSnapshot().value).includes('secret-that-must-not-enter-settings'), false)

  await controller.removeProfile('zilliz-cloud')
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value)), { profiles: [], activeProfileId: '' })

  const savedLocalProfile = await controller.saveProfile({
    id: '',
    name: '',
    kind: 'local',
    endpoint: 'http://127.0.0.1:19530',
    database: 'default',
    credentialRef: '',
  })
  assert.equal(savedLocalProfile.id, 'local')
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value)), {
    profiles: [{
      id: 'local',
      name: 'Local Milvus',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'default',
    }],
    activeProfileId: 'local',
  })
})
