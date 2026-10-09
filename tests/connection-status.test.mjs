import assert from 'node:assert/strict'
import test from 'node:test'

const activeSignal = new AbortController().signal

test('the authenticated RPC handler checks a deployment and never returns its credential', async () => {
  const { createMilvusStatusRpcHandler } = await import('../connection-status.mjs')
  const secret = 'never-browser-visible'
  const handler = createMilvusStatusRpcHandler({
    profileSource: () => ({
      profiles: [{
        id: 'cloud-rag',
        name: 'Cloud RAG',
        kind: 'zilliz-cloud',
        endpoint: 'https://127.0.0.1:1',
        credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN',
      }],
      embeddingProfiles: [],
      retrievalBindings: [],
      retrievalPolicies: [],
    }),
    resolveCredential: async () => ({ value: secret, source: 'file' }),
    createTransport: () => { throw new Error('not used') },
  })

  const response = await handler('connection-check', { profileId: 'cloud-rag' }, activeSignal)

  assert.equal(response.ok, true)
  assert.equal(response.value.profileId, 'cloud-rag')
  assert.equal(['ready', 'blocked', 'failed'].includes(response.value.state), true)
  assert.equal(JSON.stringify(response).includes(secret), false)
})

test('the embedding RPC resolves only the requested profile and publishes no credential value', async () => {
  const { checkEmbeddingStatus } = await import('../connection-status.mjs')
  const secret = 'embedding-secret'
  const result = await checkEmbeddingStatus({
    payload: { profileId: 'openai-small' },
    profileSource: () => ({
      embeddingProfiles: [{ id: 'openai-small', credentialRef: 'DSH_EMBEDDING_OPENAI_API_KEY' }],
    }),
    resolveCredential: async () => ({ value: secret }),
    checkProfile: async (profile, { resolveCredential }) => {
      assert.equal((await resolveCredential(profile.credentialRef)).value, secret)
      return { profileId: profile.id, checkedAt: 9, state: 'ready', message: 'Connected to the embedding provider.' }
    },
  })

  assert.equal(result.state, 'ready')
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('the collection RPC lists and inspects schema through the Host with safe capability facts', async () => {
  const { checkCollectionStatus } = await import('../connection-status.mjs')
  const secret = 'must-never-enter-collection-status'
  const result = await checkCollectionStatus({
    payload: { profileId: 'local-dev', collection: 'documents' },
    profileSource: () => ({
      profiles: [{ id: 'local-dev', credentialRef: 'DSH_MILVUS_LOCAL_TOKEN' }],
      embeddingProfiles: [{ id: 'openai-small', provider: 'openai', model: 'text-embedding-3-small' }],
      retrievalBindings: [{
        milvusProfileId: 'local-dev',
        collection: 'documents',
        vectorField: 'dense_vector',
        embeddingProfileId: 'openai-small',
      }],
      retrievalPolicies: [],
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

  assert.equal(result.state, 'ready')
  assert.deepEqual(result.collections, ['documents', 'other'])
  assert.equal(result.collection.capabilities.dense.state, 'ready')
  assert.equal(result.collection.capabilities.bm25.state, 'ready')
  assert.equal(result.collection.capabilities.hybrid.state, 'ready')
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal('indexes' in result.collection, false)
})

test('a collection list request returns a safe result without an inspection', async () => {
  const { checkCollectionStatus } = await import('../connection-status.mjs')
  const result = await checkCollectionStatus({
    payload: { profileId: 'local-dev' },
    profileSource: () => ({ profiles: [{ id: 'local-dev' }] }),
    createTransport: () => ({
      listCollections: async () => ({ kind: 'ready', collections: ['documents'] }),
    }),
    now: () => 101,
  })

  assert.equal(result.collection, undefined)
  assert.deepEqual(result.collections, ['documents'])
})

test('the RPC handler rejects malformed and unknown requests without dispatching', async () => {
  const { createMilvusStatusRpcHandler } = await import('../connection-status.mjs')
  const handler = createMilvusStatusRpcHandler({
    profileSource: () => ({ profiles: [] }),
    resolveCredential: async () => undefined,
    createTransport: () => { throw new Error('not used') },
  })

  const malformed = await handler('connection-check', {}, activeSignal)
  const unknown = await handler('delete-everything', {}, activeSignal)

  assert.equal(malformed.ok, false)
  assert.equal(malformed.error.code, 'dsh-milvus/bad-request')
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'dsh-milvus/not-found')
})

test('the authenticated Fetch route validates JSON and returns the safe dispatcher envelope', async () => {
  const { createMilvusStatusFetchHandler } = await import('../connection-status.mjs')
  const fetchStatus = createMilvusStatusFetchHandler({
    profileSource: () => ({ profiles: [] }),
    resolveCredential: async () => undefined,
    createTransport: () => { throw new Error('not used') },
  })

  const response = await fetchStatus(new Request('http://localhost/api/dsh-milvus.status', {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ method: 'connection-check', payload: { profileId: 'missing' } }),
  }))
  const result = await response.json()

  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(result.ok, true)
  assert.equal(result.value.profileId, 'missing')
  assert.equal(result.value.state, 'blocked')

  const malformed = await fetchStatus(new Request('http://localhost/api/dsh-milvus.status', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{',
  }))
  assert.equal(malformed.status, 400)
  assert.equal((await malformed.json()).error.code, 'dsh-milvus/bad-request')
})
