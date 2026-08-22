import assert from 'node:assert/strict'
import test from 'node:test'

test('connection status starts idle before a browser requests a check', async () => {
  const { ConnectionStatusConfig } = await import('../connection-status.mjs')

  assert.deepEqual(ConnectionStatusConfig({}), { checks: {}, embeddingChecks: {}, collectionChecks: {} })
})

test('a browser check request is resolved on the Host and publishes only its safe outcome', async () => {
  const { attachConnectionStatusMonitor } = await import('../connection-status.mjs')
  let watcher
  let status = {
    request: { profileId: 'cloud-rag', requestId: 1 },
    checks: {},
  }
  const statusScope = {
    watch(callback) {
      watcher = callback
      return () => {}
    },
    get() {
      return status
    },
    async update(patch) {
      status = { ...status, ...patch }
    },
  }
  const secret = 'never-browser-visible'

  attachConnectionStatusMonitor({
    statusScope,
    profileSource: () => ({ profiles: [{ id: 'cloud-rag', credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN' }] }),
    resolveCredential: async () => ({ value: secret, source: 'file' }),
    checkProfile: async (profile, { resolveCredential }) => {
      assert.equal((await resolveCredential(profile.credentialRef)).value, secret)
      return {
        profileId: profile.id,
        checkedAt: 1234,
        state: 'ready',
        message: 'Connected to Milvus.',
      }
    },
  })

  await watcher(status)

  assert.deepEqual(status.checks, {
    'cloud-rag': {
      profileId: 'cloud-rag',
      checkedAt: 1234,
      state: 'ready',
      message: 'Connected to Milvus.',
    },
  })
  assert.equal(JSON.stringify(status).includes(secret), false)
})

test('a later browser request prevents an older probe from replacing its status', async () => {
  const { attachConnectionStatusMonitor } = await import('../connection-status.mjs')
  let watcher
  const original = { request: { profileId: 'local-dev', requestId: 1 }, checks: {} }
  let status = original
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const statusScope = {
    watch(callback) { watcher = callback; return () => {} },
    get() { return status },
    async update() { throw new Error('stale probe must not write') },
  }

  attachConnectionStatusMonitor({
    statusScope,
    profileSource: () => ({ profiles: [{ id: 'local-dev' }] }),
    resolveCredential: async () => undefined,
    checkProfile: async () => {
      await pending
      return { profileId: 'local-dev', checkedAt: 1, state: 'ready', message: 'Connected to Milvus.' }
    },
  })

  const running = watcher(original)
  status = { request: { profileId: 'local-dev', requestId: 2 }, checks: {} }
  release()
  await running
})

test('an embedding check request resolves only the named profile and publishes no credential value', async () => {
  const { attachEmbeddingStatusMonitor } = await import('../connection-status.mjs')
  let watcher
  let status = {
    embeddingRequest: { profileId: 'openai-small', requestId: 7 },
    embeddingChecks: {},
  }
  const statusScope = {
    watch(callback) { watcher = callback; return () => {} },
    get() { return status },
    async update(patch) { status = { ...status, ...patch } },
  }
  const secret = 'embedding-secret'
  attachEmbeddingStatusMonitor({
    statusScope,
    profileSource: () => ({
      embeddingProfiles: [{ id: 'openai-small', credentialRef: 'DSH_EMBEDDING_OPENAI_API_KEY' }],
    }),
    resolveCredential: async () => ({ value: secret }),
    checkProfile: async (profile, { resolveCredential }) => {
      assert.equal((await resolveCredential(profile.credentialRef)).value, secret)
      return { profileId: profile.id, checkedAt: 9, state: 'ready', message: 'Connected to the embedding provider.' }
    },
  })

  await watcher(status)

  assert.equal(status.embeddingChecks['openai-small'].state, 'ready')
  assert.equal(JSON.stringify(status).includes(secret), false)
})

test('a collection request lists and inspects schema through the Host with safe capability facts', async () => {
  const { attachCollectionStatusMonitor, ConnectionStatusConfig } = await import('../connection-status.mjs')
  let watcher
  let status = {
    collectionRequest: { profileId: 'local-dev', collection: 'documents', requestId: 11 },
    collectionChecks: {},
  }
  const statusScope = {
    watch(callback) { watcher = callback; return () => {} },
    get() { return status },
    async update(patch) { status = { ...status, ...patch } },
  }
  const secret = 'must-never-enter-collection-status'
  attachCollectionStatusMonitor({
    statusScope,
    profileSource: () => ({
      profiles: [{ id: 'local-dev', credentialRef: 'DSH_MILVUS_LOCAL_TOKEN' }],
      embeddingProfiles: [{ id: 'openai-small', provider: 'openai', model: 'text-embedding-3-small' }],
      retrievalBindings: [{
        milvusProfileId: 'local-dev',
        collection: 'documents',
        vectorField: 'dense_vector',
        embeddingProfileId: 'openai-small',
      }],
    }),
    createTransport: (profile) => {
      assert.equal(profile.credentialRef, 'DSH_MILVUS_LOCAL_TOKEN')
      return {
        listCollections: async () => ({ kind: 'ready', collections: ['other', 'documents'] }),
        preflightCollection: async (name) => ({
          kind: 'ready',
          collection: {
            name,
            fields: [
              { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
              { name: 'text', dataType: 'VarChar', kind: 'scalar', analyzerEnabled: true },
              { name: 'dense_vector', dataType: 'FloatVector', kind: 'vector', dimension: 1536 },
              { name: 'sparse_vector', dataType: 'SparseFloatVector', kind: 'vector', functionOutput: true },
            ],
            retrievalSchema: {
              schemaFingerprint: `sha256:${'a'.repeat(64)}`,
              bm25Routes: [{
                functionName: 'bm25',
                inputField: 'text',
                outputField: 'sparse_vector',
                metricType: 'BM25',
              }],
              unsupportedSparseFields: [],
            },
            diagnostic: secret,
          },
        }),
      }
    },
    now: () => 100,
  })

  await watcher(status)

  const result = status.collectionChecks['local-dev']
  assert.equal(result.state, 'ready')
  assert.deepEqual(result.collections, ['documents', 'other'])
  assert.equal(result.collection.capabilities.dense.state, 'ready')
  assert.equal(result.collection.capabilities.bm25.state, 'ready')
  assert.equal(result.collection.capabilities.hybrid.state, 'ready')
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal('indexes' in result.collection, false)
  assert.doesNotThrow(() => ConnectionStatusConfig(status))
})

test('a collection list result without an inspection passes the real status schema', async () => {
  const { attachCollectionStatusMonitor, ConnectionStatusConfig } = await import('../connection-status.mjs')
  let watcher
  let status = {
    collectionRequest: { profileId: 'local-dev', requestId: 12 },
    collectionChecks: {},
  }
  const statusScope = {
    watch(callback) { watcher = callback; return () => {} },
    get() { return status },
    async update(patch) {
      status = ConnectionStatusConfig({ ...status, ...patch })
    },
  }
  attachCollectionStatusMonitor({
    statusScope,
    profileSource: () => ({ profiles: [{ id: 'local-dev' }] }),
    createTransport: () => ({
      listCollections: async () => ({ kind: 'ready', collections: ['documents'] }),
    }),
    now: () => 101,
  })

  await watcher(status)

  assert.equal(status.collectionChecks['local-dev'].collection, undefined)
  assert.deepEqual(status.collectionChecks['local-dev'].collections, ['documents'])
})

test('a newer collection selection prevents an older preflight from publishing stale schema', async () => {
  const { attachCollectionStatusMonitor } = await import('../connection-status.mjs')
  let watcher
  const original = {
    collectionRequest: { profileId: 'local-dev', collection: 'old', requestId: 1 },
    collectionChecks: {},
  }
  let status = original
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const statusScope = {
    watch(callback) { watcher = callback; return () => {} },
    get() { return status },
    async update() { throw new Error('stale collection preflight must not write') },
  }
  attachCollectionStatusMonitor({
    statusScope,
    profileSource: () => ({ profiles: [{ id: 'local-dev' }] }),
    createTransport: () => ({
      listCollections: async () => ({ kind: 'ready', collections: ['old', 'new'] }),
      preflightCollection: async () => {
        await pending
        return { kind: 'blocked', message: 'Old result.' }
      },
    }),
  })

  const running = watcher(original)
  status = {
    collectionRequest: { profileId: 'local-dev', collection: 'new', requestId: 2 },
    collectionChecks: {},
  }
  release()
  await running
})
