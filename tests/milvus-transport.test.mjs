import assert from 'node:assert/strict'
import test from 'node:test'

test('collection preflight is fixed to its selected profile database and returns normalized collection facts', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const calls = []
  let resolvedRef
  let clientOptions
  const transport = createMilvusTransport({
    profile: {
      id: 'cloud-rag',
      kind: 'zilliz-cloud',
      endpoint: 'https://in01-example.cloud.zilliz.com',
      database: 'rag',
      credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN',
    },
    resolveCredential: async (ref) => {
      resolvedRef = ref
      return { value: 'runtime-token' }
    },
    createClient: (options) => {
      clientOptions = options
      return {
        listCollections: async (request) => {
          calls.push(['list', request])
          return { code: 0, data: ['books'] }
        },
        describeCollection: async (request) => {
          calls.push(['describe', request])
          return {
            code: 0,
            data: {
              collectionName: 'books',
              fields: [
                { name: 'id', type: 'Int64', primaryKey: true },
                { name: 'title', type: 'VarChar' },
                { name: 'embedding', type: 'FloatVector' },
              ],
              indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
            },
          }
        },
        getCollectionStatistics: async (request) => {
          calls.push(['statistics', request])
          return { code: 0, data: { rowCount: 3 } }
        },
        getCollectionLoadState: async (request) => {
          calls.push(['load-state', request])
          return { code: 0, data: { loadState: 'Loaded', loadProgress: 100 } }
        },
      }
    },
  })

  const result = await transport.preflightCollection('books')

  assert.equal(resolvedRef, 'DSH_MILVUS_CLOUD_RAG_TOKEN')
  assert.deepEqual(clientOptions, {
    endpoint: 'https://in01-example.cloud.zilliz.com',
    database: 'rag',
    token: 'runtime-token',
    timeout: 10_000,
  })
  assert.deepEqual(calls, [
    ['list', { dbName: 'rag' }],
    ['describe', { collectionName: 'books', dbName: 'rag' }],
    ['statistics', { collectionName: 'books', dbName: 'rag' }],
    ['load-state', { collectionName: 'books', dbName: 'rag' }],
  ])
  assert.deepEqual(result, {
    kind: 'ready',
    collection: {
      name: 'books',
      fields: [
        { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
        { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false },
        { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false },
      ],
      indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
      rowCount: 3,
      loadState: 'Loaded',
      loadProgress: 100,
    },
  })
})

test('collection discovery returns only names authorized in the selected profile database', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  let request
  const transport = createMilvusTransport({
    profile: {
      id: 'local-dev',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'rag',
    },
    resolveCredential: async () => undefined,
    createClient: () => ({
      listCollections: async (next) => {
        request = next
        return { code: 0, data: ['books', 'payments'] }
      },
    }),
  })

  const result = await transport.listCollections()

  assert.deepEqual(request, { dbName: 'rag' })
  assert.deepEqual(result, {
    kind: 'ready',
    collections: ['books', 'payments'],
  })
})

test('uses an empty SDK database for a Cloud profile without a database, preventing the SDK default', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const calls = []
  let clientOptions
  const transport = createMilvusTransport({
    profile: {
      id: 'zilliz-cloud',
      kind: 'zilliz-cloud',
      endpoint: 'https://in01-example.cloud.zilliz.com',
      credentialRef: 'DSH_MILVUS_ZILLIZ_CLOUD_TOKEN',
    },
    resolveCredential: async () => ({ value: 'runtime-token' }),
    createClient: (options) => {
      clientOptions = options
      return {
        listCollections: async (request) => {
          calls.push(['list', request])
          return { code: 0, data: ['books'] }
        },
        query: async (request) => {
          calls.push(['query', request])
          return { code: 0, data: [{ id: 1 }] }
        },
      }
    },
  })

  assert.deepEqual(await transport.listCollections(), { kind: 'ready', collections: ['books'] })
  assert.deepEqual(await transport.queryCollection({
    collectionName: 'books',
    outputFields: ['id'],
    limit: 1,
  }), { kind: 'ready', rows: [{ id: 1 }] })
  assert.deepEqual(clientOptions, {
    endpoint: 'https://in01-example.cloud.zilliz.com',
    database: '',
    token: 'runtime-token',
    timeout: 10_000,
  })
  assert.deepEqual(calls, [
    ['list', {}],
    ['query', { collectionName: 'books', outputFields: ['id'], limit: 1 }],
  ])
})

test('a controlled scalar query is fixed to its selected profile database', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  let request
  const transport = createMilvusTransport({
    profile: {
      id: 'local-dev',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'rag',
    },
    resolveCredential: async () => undefined,
    createClient: () => ({
      query: async (next) => {
        request = next
        return { code: 0, data: [{ id: 1, title: 'Milvus basics' }] }
      },
    }),
  })

  const result = await transport.queryCollection({
    collectionName: 'books',
    filter: 'id >= 1',
    outputFields: ['id', 'title'],
    limit: 10,
  })

  assert.deepEqual(request, {
    collectionName: 'books',
    dbName: 'rag',
    filter: 'id >= 1',
    outputFields: ['id', 'title'],
    limit: 10,
  })
  assert.deepEqual(result, {
    kind: 'ready',
    rows: [{ id: 1, title: 'Milvus basics' }],
  })
})

test('preflight blocks an absent collection before describing an unapproved target', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  let described = false
  const transport = createMilvusTransport({
    profile: {
      id: 'local-dev',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'default',
    },
    resolveCredential: async () => undefined,
    createClient: () => ({
      listCollections: async () => ({ code: 0, data: ['books'] }),
      describeCollection: async () => { described = true },
      getCollectionStatistics: async () => { described = true },
      getCollectionLoadState: async () => { described = true },
    }),
  })

  const result = await transport.preflightCollection('payments')

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'collection_absent',
    message: 'The selected collection is not available in this profile.',
  })
  assert.equal(described, false)
})

test('preflight blocks locally when no deployment profile is bound', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  let created = false
  const transport = createMilvusTransport({
    resolveCredential: async () => undefined,
    createClient: () => { created = true },
  })

  const result = await transport.preflightCollection('books')

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'profile_unavailable',
    message: 'Select a Milvus deployment profile before using this operation.',
  })
  assert.equal(created, false)
})

test('preflight blocks a Cloud profile whose configured credential cannot be resolved', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  let created = false
  const transport = createMilvusTransport({
    profile: {
      id: 'cloud-rag',
      kind: 'zilliz-cloud',
      endpoint: 'https://in01-example.cloud.zilliz.com',
      database: 'rag',
      credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN',
    },
    resolveCredential: async () => undefined,
    createClient: () => { created = true },
  })

  const result = await transport.preflightCollection('books')

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'credential_unavailable',
    message: 'The selected profile credential is unavailable.',
  })
  assert.equal(created, false)
})

test('preflight does not disclose a credential-resolution failure or downgrade to an anonymous request', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const secret = 'credential-resolution-detail'
  let created = false
  const transport = createMilvusTransport({
    profile: {
      id: 'local-authenticated',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'default',
      credentialRef: 'DSH_MILVUS_LOCAL_TOKEN',
    },
    resolveCredential: async () => { throw new Error(secret) },
    createClient: () => { created = true },
  })

  const result = await transport.preflightCollection('books')

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'credential_unavailable',
    message: 'The selected profile credential is unavailable.',
  })
  assert.equal(created, false)
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('preflight converts an SDK failure into a non-disclosing deployment blocked outcome', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const secret = 'do-not-return-this-token'
  const transport = createMilvusTransport({
    profile: {
      id: 'local-dev',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'default',
      credentialRef: 'DSH_MILVUS_LOCAL_TOKEN',
    },
    resolveCredential: async () => ({ value: secret }),
    createClient: () => ({
      listCollections: async () => { throw new Error(`dial failure for ${secret}`) },
    }),
  })

  const result = await transport.preflightCollection('books')

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'deployment_unreachable',
    message: 'The selected Milvus deployment could not be reached.',
  })
  assert.equal(JSON.stringify(result).includes(secret), false)
})

test('preflight blocks a collection schema whose fields cannot be safely named', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const transport = createMilvusTransport({
    profile: {
      id: 'local-dev',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'default',
    },
    resolveCredential: async () => undefined,
    createClient: () => ({
      listCollections: async () => ({ code: 0, data: ['broken'] }),
      describeCollection: async () => ({
        code: 0,
        data: { collectionName: 'broken', fields: [{ type: 'FloatVector' }], indexes: [] },
      }),
      getCollectionStatistics: async () => ({ code: 0, data: { rowCount: 0 } }),
      getCollectionLoadState: async () => ({ code: 0, data: { loadState: 'Loaded', loadProgress: 100 } }),
    }),
  })

  const result = await transport.preflightCollection('broken')

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'unsupported_schema',
    message: 'The collection schema cannot support a controlled scalar query.',
  })
})
