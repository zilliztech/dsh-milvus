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
                { name: 'embedding', type: 'FloatVector', params: [{ key: 'dim', value: '384' }] },
              ],
              indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
              description: 'Book embeddings',
              shardsNum: 2,
              enableDynamicField: false,
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
      description: 'Book embeddings',
      fields: [
        { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
        { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false },
        { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false, dimension: 384 },
      ],
      indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
      functions: [],
      retrievalSchema: {
        schemaFingerprint: 'sha256:fe2afa06f7331ce631437c2ef1f7acc4e9affcb1e2f3b79c79efac048f0ff835',
        bm25Routes: [],
        unsupportedSparseFields: [],
      },
      rowCount: 3,
      loadState: 'Loaded',
      loadProgress: 100,
      shardsNum: 2,
      enableDynamicField: false,
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

test('controlled get and dense search use the selected database and constrained SDK requests', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const calls = []
  const transport = createMilvusTransport({
    profile: {
      id: 'local-dev',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'rag',
    },
    resolveCredential: async () => undefined,
    createClient: () => ({
      get: async (request) => {
        calls.push(['get', request])
        return { code: 0, data: [{ id: 2, title: 'Vectors' }] }
      },
      search: async (request) => {
        calls.push(['search', request])
        return { code: 0, data: [{ id: 2, title: 'Vectors', distance: 0.95 }], topks: [1] }
      },
    }),
  })

  assert.deepEqual(await transport.getCollection({
    collectionName: 'books',
    ids: [2],
    outputFields: ['id', 'title'],
  }), { kind: 'ready', rows: [{ id: 2, title: 'Vectors' }] })

  assert.deepEqual(await transport.searchCollection({
    collectionName: 'books',
    vector: [0.1, 0.2],
    vectorField: 'embedding',
    filter: 'year >= 2024',
    outputFields: ['id', 'title'],
    limit: 3,
    partitionNames: ['recent'],
  }), { kind: 'ready', rows: [{ id: 2, title: 'Vectors', distance: 0.95 }] })

  assert.deepEqual(calls, [
    ['get', {
      collectionName: 'books',
      id: [2],
      outputFields: ['id', 'title'],
      dbName: 'rag',
    }],
    ['search', {
      collectionName: 'books',
      data: [[0.1, 0.2]],
      annsField: 'embedding',
      filter: 'year >= 2024',
      outputFields: ['id', 'title'],
      limit: 3,
      partitionNames: ['recent'],
      dbName: 'rag',
    }],
  ])
})

test('preflight derives a BM25 route only from analyzer, Function, sparse field, and BM25 index facts', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const transport = createMilvusTransport({
    profile: { id: 'local-dev', endpoint: 'http://127.0.0.1:19530', database: 'rag' },
    resolveCredential: async () => undefined,
    createClient: () => ({
      listCollections: async () => ({ code: 0, data: ['books'] }),
      describeCollection: async () => ({
        code: 0,
        data: {
          collectionName: 'books',
          fields: [
            { name: 'id', type: 'Int64', primaryKey: true },
            { name: 'text', type: 'VarChar', params: [{ key: 'enable_analyzer', value: 'true' }] },
            { name: 'sparse', type: 'SparseFloatVector', isFunctionOutput: true },
          ],
          indexes: [{ fieldName: 'sparse', indexName: 'sparse_idx', metricType: 'BM25' }],
          functions: [{ name: 'text_bm25', type: 1, inputFieldNames: ['text'], outputFieldNames: ['sparse'], params: null }],
        },
      }),
      getCollectionStatistics: async () => ({ code: 0, data: { rowCount: 2 } }),
      getCollectionLoadState: async () => ({ code: 0, data: { loadState: 'Loaded', loadProgress: 100 } }),
    }),
  })

  const result = await transport.preflightCollection('books')
  assert.equal(result.kind, 'ready')
  assert.equal(result.collection.fields.find((field) => field.name === 'text').analyzerEnabled, true)
  assert.deepEqual(result.collection.functions, [{
    name: 'text_bm25', type: 'BM25', inputFieldNames: ['text'], outputFieldNames: ['sparse'],
  }])
  assert.deepEqual(result.collection.retrievalSchema.bm25Routes, [{
    functionName: 'text_bm25', inputField: 'text', outputField: 'sparse', indexName: 'sparse_idx', metricType: 'BM25',
  }])
})

test('BM25 and hybrid transports send constrained raw-text and dense-first requests', async () => {
  const { createMilvusTransport } = await import('../milvus-transport.mjs')
  const calls = []
  const transport = createMilvusTransport({
    profile: { id: 'local-dev', endpoint: 'http://127.0.0.1:19530', database: 'rag' },
    resolveCredential: async () => undefined,
    createClient: () => ({
      search: async (request) => {
        calls.push(['text', request])
        return { code: 0, data: [{ id: 1, text: 'exact terms', distance: 4.2 }] }
      },
      hybridSearch: async (request) => {
        calls.push(['hybrid', request])
        return { code: 0, data: [{ id: 1, text: 'combined', distance: 0.8 }] }
      },
    }),
  })

  assert.equal((await transport.textSearchCollection({
    collectionName: 'books', queryText: 'exact terms', sparseField: 'sparse', filter: 'id > 0',
    outputFields: ['id', 'text'], limit: 3, partitionNames: ['recent'],
  })).kind, 'ready')
  assert.equal((await transport.hybridSearchCollection({
    collectionName: 'books', vector: [0.1, 0.2], denseField: 'dense', queryText: 'exact terms', sparseField: 'sparse',
    filter: 'id > 0', outputFields: ['id', 'text'], limit: 3, partitionNames: ['recent'],
    rerank: { strategy: 'weighted', params: { weights: [0.7, 0.3] } },
  })).kind, 'ready')

  assert.deepEqual(calls, [
    ['text', {
      collectionName: 'books', data: ['exact terms'], annsField: 'sparse', filter: 'id > 0',
      outputFields: ['id', 'text'], limit: 3, partitionNames: ['recent'], dbName: 'rag',
    }],
    ['hybrid', {
      collectionName: 'books',
      search: [
        { data: [[0.1, 0.2]], annsField: 'dense', limit: 3, filter: 'id > 0' },
        { data: ['exact terms'], annsField: 'sparse', limit: 3, filter: 'id > 0' },
      ],
      rerank: { strategy: 'weighted', params: { weights: [0.7, 0.3] } },
      partitionNames: ['recent'], outputFields: ['id', 'text'], limit: 3, dbName: 'rag',
    }],
  ])
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
