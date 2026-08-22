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

  const embeddingDraft = {
    id: 'openai-embedding',
    name: 'OpenAI Embedding',
    provider: 'openai',
    model: 'text-embedding-3-small',
    credentialRef: 'DSH_EMBEDDING_OPENAI_OPENAI_EMBEDDING_API_KEY',
  }
  assert.equal(await controller.writeCredential(embeddingDraft, 'embedding-secret'), true)
  const savedEmbedding = await controller.saveEmbeddingProfile(embeddingDraft)
  assert.deepEqual(JSON.parse(JSON.stringify(savedEmbedding)), embeddingDraft)

  const savedBinding = await controller.saveRetrievalBinding({
    milvusProfileId: 'local',
    collection: 'documents',
    vectorField: 'embedding',
    embeddingProfileId: 'openai-embedding',
  })
  assert.equal(savedBinding.collection, 'documents')
  assert.equal(JSON.stringify(profileScope.getSnapshot().value).includes('embedding-secret'), false)
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value.retrievalBindings)), [{
    milvusProfileId: 'local',
    collection: 'documents',
    vectorField: 'embedding',
    embeddingProfileId: 'openai-embedding',
  }])

  const savedPolicy = await controller.saveRetrievalPolicy({
    milvusProfileId: 'local',
    collection: 'documents',
    textField: 'text',
    sparseField: 'sparse',
    rerank: { strategy: 'weighted', denseWeight: '0.7', bm25Weight: '0.3' },
  })
  assert.deepEqual(JSON.parse(JSON.stringify(savedPolicy)), {
    milvusProfileId: 'local',
    collection: 'documents',
    textField: 'text',
    sparseField: 'sparse',
    rerank: { strategy: 'weighted', denseWeight: 0.7, bm25Weight: 0.3 },
  })
  assert.deepEqual(
    JSON.parse(JSON.stringify(profileScope.getSnapshot().value.retrievalPolicies)),
    JSON.parse(JSON.stringify([savedPolicy])),
  )

  const policyKey = ['local', 'documents'].join('\u0000')
  profileScope.getSnapshot().value.retrievalPolicies[0].schemaFingerprint = `sha256:${'a'.repeat(64)}`
  const editedPolicy = await controller.saveRetrievalPolicy({
    ...savedPolicy,
    textField: 'body',
    rerank: { strategy: 'rrf', k: '80' },
  }, policyKey)
  assert.deepEqual(JSON.parse(JSON.stringify(editedPolicy)), {
    milvusProfileId: 'local',
    collection: 'documents',
    textField: 'body',
    sparseField: 'sparse',
    schemaFingerprint: `sha256:${'a'.repeat(64)}`,
    rerank: { strategy: 'rrf', k: 80 },
  })
  assert.equal(editedPolicy.schemaFingerprint, `sha256:${'a'.repeat(64)}`)

  await controller.removeRetrievalPolicy(policyKey)
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value.retrievalPolicies)), [])

  await controller.requestEmbeddingCheck(savedEmbedding)
  assert.equal(statusScope.getSnapshot().value.embeddingRequest.profileId, 'openai-embedding')

  await controller.requestCollectionDiscovery(savedLocalProfile, 'documents')
  assert.deepEqual(JSON.parse(JSON.stringify(statusScope.getSnapshot().value.collectionRequest)), {
    profileId: 'local',
    collection: 'documents',
    requestId: statusScope.getSnapshot().value.collectionRequest.requestId,
  })

  await controller.removeEmbeddingProfile('openai-embedding')
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value.embeddingProfiles)), [])
  assert.deepEqual(JSON.parse(JSON.stringify(profileScope.getSnapshot().value.retrievalBindings)), [])

  const semantic = await controller.configureSemantic({
    milvusProfileId: 'local',
    collection: 'documents',
    vectorField: 'dense_vector',
    provider: 'gemini',
    model: 'gemini-embedding-001',
    apiKey: 'semantic-common-path-secret',
  })
  assert.deepEqual(JSON.parse(JSON.stringify(semantic.binding)), {
    milvusProfileId: 'local',
    collection: 'documents',
    vectorField: 'dense_vector',
    embeddingProfileId: 'gemini-embedding',
  })
  assert.equal(semantic.embeddingProfile.provider, 'gemini')
  assert.equal(JSON.stringify(profileScope.getSnapshot().value).includes('semantic-common-path-secret'), false)
  assert.deepEqual(credentialWrites.at(-1), {
    ref: 'DSH_EMBEDDING_GEMINI_GEMINI_EMBEDDING_API_KEY',
    value: 'semantic-common-path-secret',
  })
})
