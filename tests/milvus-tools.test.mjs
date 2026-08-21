import assert from 'node:assert/strict'
import test from 'node:test'

test('registers a profile-bound native collection discovery tool', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  const ctx = {
    tools: {
      register(definition) {
        registered.push(definition)
        return () => {}
      },
    },
  }
  const profile = {
    id: 'local-dev',
    name: 'Local development',
    kind: 'local',
    endpoint: 'http://127.0.0.1:19530',
    database: 'default',
  }
  let requestedProfile

  registerMilvusTools(ctx, {
    bindingFor: () => profile,
    createTransport(nextProfile) {
      requestedProfile = nextProfile
      return {
        listCollections: async () => ({ kind: 'ready', collections: ['books', 'payments'] }),
      }
    },
  })

  assert.ok(registered.some((tool) => tool.name === 'milvus_list_collections'))

  const list = registered.find((tool) => tool.name === 'milvus_list_collections')
  assert.deepEqual(Object.keys(list.parameters.properties), [])
  const result = await list.execute({}, { signal: AbortSignal.timeout(1000) })

  assert.equal(requestedProfile, profile)
  assert.deepEqual(result, {
    kind: 'ready',
    source: { profileId: 'local-dev', profileName: 'Local development', database: 'default' },
    collections: ['books', 'payments'],
  })
})

test('describes an existing collection with inspectable metadata through the bound profile preflight', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  const profile = {
    id: 'local-dev',
    name: 'Local development',
    kind: 'local',
    endpoint: 'http://127.0.0.1:19530',
    database: 'default',
  }
  let requestedCollection

  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => profile,
    createTransport: () => ({
      preflightCollection: async (collection) => {
        requestedCollection = collection
        return {
          kind: 'ready',
          collection: {
            name: 'books',
            fields: [
              { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
              { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false },
            ],
            indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
            rowCount: 2,
            loadState: 'Loaded',
            loadProgress: 100,
          },
        }
      },
    }),
  })

  const describe = registered.find((tool) => tool.name === 'milvus_describe_collection')
  const result = await describe.execute({ collection: 'books' }, { signal: AbortSignal.timeout(1000) })

  assert.equal(requestedCollection, 'books')
  assert.deepEqual(result, {
    kind: 'ready',
    source: { profileId: 'local-dev', profileName: 'Local development', database: 'default' },
    collection: {
      name: 'books',
      fields: [
        { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
        { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false },
      ],
      indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
      functions: [],
      retrievalSchema: { schemaFingerprint: 'unavailable', bm25Routes: [], unsupportedSparseFields: [] },
      capabilities: {
        dense: { state: 'blocked', fields: [], blocker: 'retrieval_binding_absent' },
        bm25: { state: 'blocked', routes: [], blocker: 'bm25_route_absent' },
        hybrid: { state: 'blocked', blockers: ['retrieval_binding_absent', 'bm25_route_absent'] },
      },
      rowCount: 2,
      loadState: 'Loaded',
      loadProgress: 100,
    },
  })

  const rendered = describe.output.render({}, result)
  assert.equal(rendered.length, 1)
  assert.match(rendered[0].text, /Collection “books”/)
  assert.match(rendered[0].text, /id \(Int64, scalar, primary key\)/)
  assert.match(rendered[0].text, /embedding \(FloatVector, vector\)/)
  assert.match(rendered[0].text, /embedding_idx \(field: embedding, metric: COSINE\)/)
  assert.match(rendered[0].text, /Row count: 2/)
  assert.match(rendered[0].text, /Load state: Loaded \(100%\)/)
})

test('queries only schema-approved scalar fields and applies the default row limit', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  const profile = {
    id: 'local-dev',
    name: 'Local development',
    kind: 'local',
    endpoint: 'http://127.0.0.1:19530',
    database: 'default',
  }
  let queryRequest
  const collection = {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false },
      { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false },
    ],
    indexes: [],
    rowCount: 2,
    loadState: 'Loaded',
    loadProgress: 100,
  }

  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => profile,
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection }),
      queryCollection: async (request) => {
        queryRequest = request
        return {
          kind: 'ready',
          rows: [{ id: 1, title: 'Milvus basics', embedding: [0.1, 0.2] }],
        }
      },
    }),
  })

  const query = registered.find((tool) => tool.name === 'milvus_query')
  const result = await query.execute({
    collection: 'books',
    filter: 'id >= 1',
    fields: ['id', 'title'],
  }, { signal: AbortSignal.timeout(1000) })

  assert.deepEqual(queryRequest, {
    collectionName: 'books',
    filter: 'id >= 1',
    outputFields: ['id', 'title'],
    limit: 10,
  })
  assert.deepEqual(result, {
    kind: 'ready',
    source: { profileId: 'local-dev', profileName: 'Local development', database: 'default' },
    rows: [{ id: 1, title: 'Milvus basics' }],
  })

  const rendered = query.output.render({}, result)
  assert.match(rendered[0].text, /returned 1 row\(s\)/)
  assert.match(rendered[0].text, /Untrusted database rows/)
  assert.match(rendered[0].text, /"id": 1/)
  assert.match(rendered[0].text, /"title": "Milvus basics"/)
})

test('blocks vector fields, unknown filter fields, and excessive query limits before query dispatch', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  let queryCalls = 0
  const collection = {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false },
    ],
    indexes: [],
    rowCount: 2,
    loadState: 'Loaded',
    loadProgress: 100,
  }

  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => ({ id: 'local-dev', name: 'Local development', database: 'default' }),
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection }),
      queryCollection: async () => { queryCalls += 1 },
    }),
  })

  const query = registered.find((tool) => tool.name === 'milvus_query')
  const execute = (args) => query.execute(args, { signal: AbortSignal.timeout(1000) })

  assert.deepEqual(await execute({ collection: 'books', fields: ['embedding'] }), {
    kind: 'blocked',
    reason: 'unsupported_field',
    message: 'The field “embedding” is not an available scalar output field for this collection.',
  })
  assert.deepEqual(await execute({ collection: 'books', filter: 'unknown == 1', fields: ['id'] }), {
    kind: 'blocked',
    reason: 'unsupported_field',
    message: 'The filter references “unknown”, which is not an available scalar field for this collection.',
  })
  assert.deepEqual(await execute({ collection: 'books', fields: ['id'], limit: 51 }), {
    kind: 'blocked',
    reason: 'invalid_query',
    message: 'limit must be an integer from 1 through 50.',
  })
  assert.equal(queryCalls, 0)
})

test('filter validation accepts Milvus scalar functions while still blocking real unknown fields', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  const requests = []
  const collection = {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false },
      { name: 'metadata', dataType: 'JSON', kind: 'scalar', primaryKey: false },
      { name: 'tags', dataType: 'Array', kind: 'scalar', primaryKey: false },
      { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false },
    ],
    indexes: [],
    rowCount: 2,
    loadState: 'Loaded',
    loadProgress: 100,
  }

  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => ({ id: 'local-dev', name: 'Local development', database: 'default' }),
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection }),
      queryCollection: async (request) => { requests.push(request); return { kind: 'ready', rows: [] } },
    }),
  })

  const query = registered.find((tool) => tool.name === 'milvus_query')
  const execute = (args) => query.execute(args, { signal: AbortSignal.timeout(1000) })

  const accepted = [
    'json_contains(metadata, \'key\')',
    'json_contains_all(metadata, [1, 2])',
    'array_contains(tags, \'fiction\')',
    'array_length(tags) > 2',
    'text_match(title, \'milvus\')',
    'title like \'Milvus%\' and id >= 0',
    'id is not null',
    'json_contains(metadata, \'a\') and array_contains(tags, \'b\') or text_match(title, \'c\')',
  ]
  for (const filter of accepted) {
    const result = await execute({ collection: 'books', filter, fields: ['id'], limit: 1 })
    assert.equal(result.kind, 'ready', `filter should be accepted: ${filter}`)
  }
  assert.equal(requests.length, accepted.length)

  const rejected = await execute({ collection: 'books', filter: 'json_contains(not_a_field, \'x\')', fields: ['id'] })
  assert.deepEqual(rejected, {
    kind: 'blocked',
    reason: 'unsupported_field',
    message: 'The filter references “not_a_field”, which is not an available scalar field for this collection.',
  })
})

test('gets entities by schema-approved primary keys without returning vector fields', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  let getRequest
  const collection = {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false },
      { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false, dimension: 3 },
    ],
    indexes: [],
    rowCount: 2,
    loadState: 'Loaded',
    loadProgress: 100,
  }
  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => ({ id: 'local-dev', name: 'Local development', database: 'default' }),
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection }),
      getCollection: async (request) => {
        getRequest = request
        return { kind: 'ready', rows: [{ id: 1, title: 'Milvus', embedding: [1, 0, 0] }] }
      },
    }),
  })

  const get = registered.find((tool) => tool.name === 'milvus_get')
  const result = await get.execute({ collection: 'books', ids: ['1'], fields: ['id', 'title'] }, { signal: AbortSignal.timeout(1000) })

  assert.deepEqual(getRequest, {
    collectionName: 'books',
    ids: ['1'],
    outputFields: ['id', 'title'],
  })
  assert.deepEqual(result.rows, [{ id: 1, title: 'Milvus' }])
  assert.equal(JSON.stringify(result).includes('embedding'), false)
})

test('dense search resolves its configured binding, embeds host-side, and returns scalar rows with provenance', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  let embedRequest
  let searchRequest
  const profile = { id: 'local-dev', name: 'Local development', database: 'default' }
  const collection = {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false },
      { name: 'year', dataType: 'Int64', kind: 'scalar', primaryKey: false },
      { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false, dimension: 3 },
    ],
    indexes: [{ fieldName: 'embedding', indexName: 'embedding_idx', metricType: 'COSINE' }],
    rowCount: 2,
    loadState: 'Loaded',
    loadProgress: 100,
  }
  const settings = {
    embeddingProfiles: [{
      id: 'openai-small',
      name: 'OpenAI small',
      provider: 'openai',
      model: 'text-embedding-3-small',
      credentialRef: 'DSH_EMBEDDING_OPENAI_SMALL_API_KEY',
    }],
    retrievalBindings: [{
      milvusProfileId: 'local-dev',
      collection: 'books',
      vectorField: 'embedding',
      embeddingProfileId: 'openai-small',
    }],
  }
  let tick = 0
  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => profile,
    settingsFor: () => settings,
    embeddingProvider: {
      embedQuery: async (request) => {
        embedRequest = request
        return {
          kind: 'ready',
          vector: [0.1, 0.2, 0.3],
          provenance: {
            provider: 'openai',
            model: 'text-embedding-3-small',
            dimension: 3,
            latencyMs: 7,
            requestId: 'req-safe',
          },
        }
      },
    },
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection }),
      searchCollection: async (request) => {
        searchRequest = request
        return {
          kind: 'ready',
          rows: [{ id: 2, title: 'Vector search', distance: 0.92, embedding: [0.1, 0.2, 0.3] }],
        }
      },
    }),
    now: () => { tick += 10; return tick },
  })

  const search = registered.find((tool) => tool.name === 'milvus_search')
  assert.deepEqual(Object.keys(search.parameters.properties).sort(), [
    'collection', 'fields', 'filter', 'limit', 'partitionNames', 'query', 'vectorField',
  ])
  const signal = AbortSignal.timeout(1000)
  const result = await search.execute({
    collection: 'books',
    query: 'semantic search',
    filter: 'year >= 2024',
    fields: ['id', 'title'],
    partitionNames: ['recent'],
    limit: 5,
  }, { signal })

  assert.equal(embedRequest.profile, settings.embeddingProfiles[0])
  assert.equal(embedRequest.text, 'semantic search')
  assert.equal(embedRequest.dimensions, 3)
  assert.equal(embedRequest.signal, signal)
  assert.deepEqual(searchRequest, {
    collectionName: 'books',
    vector: [0.1, 0.2, 0.3],
    vectorField: 'embedding',
    filter: 'year >= 2024',
    outputFields: ['id', 'title'],
    limit: 5,
    partitionNames: ['recent'],
  })
  assert.deepEqual(result, {
    kind: 'ready',
    source: { profileId: 'local-dev', profileName: 'Local development', database: 'default' },
    rows: [{ distance: 0.92, id: 2, title: 'Vector search' }],
    retrieval: {
      mode: 'dense',
      vectorField: 'embedding',
      metricType: 'COSINE',
      milvusLatencyMs: 10,
      totalLatencyMs: 30,
      embedding: {
        profileId: 'openai-small',
        provider: 'openai',
        model: 'text-embedding-3-small',
        dimension: 3,
        latencyMs: 7,
        requestId: 'req-safe',
      },
    },
  })
  assert.equal(JSON.stringify(result).includes('[0.1,0.2,0.3]'), false)
  const rendered = search.output.render({}, result)[0].text
  assert.match(rendered, /openai\/text-embedding-3-small/)
  assert.match(rendered, /metric: COSINE/)
})

test('dense search fails closed when binding, embedding profile, credential, or vector capability is unavailable', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const profile = { id: 'local-dev', name: 'Local development', database: 'default' }
  const collection = {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'embedding', dataType: 'FloatVector', kind: 'vector', primaryKey: false, dimension: 3 },
    ],
    indexes: [], rowCount: 0, loadState: 'Loaded', loadProgress: 100,
  }
  const executeWith = async (settings, embedQuery) => {
    const registered = []
    let searchCalls = 0
    registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
      bindingFor: () => profile,
      settingsFor: () => settings,
      embeddingProvider: { embedQuery },
      createTransport: () => ({
        preflightCollection: async () => ({ kind: 'ready', collection }),
        searchCollection: async () => { searchCalls += 1 },
      }),
    })
    const result = await registered.find((tool) => tool.name === 'milvus_search').execute({
      collection: 'books', query: 'query', fields: ['id'],
    }, { signal: AbortSignal.timeout(1000) })
    return { result, searchCalls }
  }

  const noBinding = await executeWith({ embeddingProfiles: [], retrievalBindings: [] }, async () => { throw new Error('must not embed') })
  assert.equal(noBinding.result.reason, 'retrieval_binding_absent')
  assert.equal(noBinding.searchCalls, 0)

  const binding = {
    milvusProfileId: 'local-dev', collection: 'books', vectorField: 'embedding', embeddingProfileId: 'missing',
  }
  const noProfile = await executeWith({ embeddingProfiles: [], retrievalBindings: [binding] }, async () => { throw new Error('must not embed') })
  assert.equal(noProfile.result.reason, 'embedding_profile_absent')
  assert.equal(noProfile.searchCalls, 0)

  const profileSettings = {
    embeddingProfiles: [{ id: 'openai', provider: 'openai', model: 'text-embedding-3-small' }],
    retrievalBindings: [{ ...binding, embeddingProfileId: 'openai' }],
  }
  const noCredential = await executeWith(profileSettings, async () => ({
    kind: 'blocked', reason: 'embedding_credential_unavailable', message: 'The embedding profile credential is unavailable.',
  }))
  assert.equal(noCredential.result.reason, 'embedding_credential_unavailable')
  assert.equal(noCredential.searchCalls, 0)
})

function hybridCollection(overrides = {}) {
  const bm25Route = {
    functionName: 'text_bm25', inputField: 'text', outputField: 'sparse', indexName: 'sparse_idx', metricType: 'BM25',
  }
  return {
    name: 'books',
    fields: [
      { name: 'id', dataType: 'Int64', kind: 'scalar', primaryKey: true },
      { name: 'text', dataType: 'VarChar', kind: 'scalar', primaryKey: false, analyzerEnabled: true },
      { name: 'dense', dataType: 'FloatVector', kind: 'vector', primaryKey: false, dimension: 3 },
      { name: 'sparse', dataType: 'SparseFloatVector', kind: 'vector', primaryKey: false, functionOutput: true },
    ],
    indexes: [
      { fieldName: 'dense', indexName: 'dense_idx', metricType: 'COSINE' },
      { fieldName: 'sparse', indexName: 'sparse_idx', metricType: 'BM25' },
    ],
    functions: [{ name: 'text_bm25', type: 'BM25', inputFieldNames: ['text'], outputFieldNames: ['sparse'] }],
    retrievalSchema: { schemaFingerprint: 'sha256:fixture', bm25Routes: [bm25Route], unsupportedSparseFields: [] },
    rowCount: 2,
    loadState: 'Loaded',
    loadProgress: 100,
    ...overrides,
  }
}

function hybridSettings(overrides = {}) {
  return {
    embeddingProfiles: [{
      id: 'openai-small', name: 'OpenAI small', provider: 'openai', model: 'text-embedding-3-small', credentialRef: 'OPENAI_KEY',
    }],
    retrievalBindings: [{
      milvusProfileId: 'local-dev', collection: 'books', vectorField: 'dense', embeddingProfileId: 'openai-small',
    }],
    retrievalPolicies: [],
    ...overrides,
  }
}

test('BM25 text search auto-selects one schema-proven route without an embedding provider', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const registered = []
  let request
  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => ({ id: 'local-dev', name: 'Local development', database: 'default' }),
    settingsFor: () => ({ embeddingProfiles: [], retrievalBindings: [] }),
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection: hybridCollection() }),
      textSearchCollection: async (value) => {
        request = value
        return { kind: 'ready', rows: [{ id: 1, text: 'Milvus BM25', distance: 2.4, sparse: { 1: 1 } }] }
      },
    }),
  })

  const tool = registered.find((item) => item.name === 'milvus_text_search')
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), [
    'collection', 'fields', 'filter', 'limit', 'partitionNames', 'query', 'textField',
  ])
  const result = await tool.execute({ collection: 'books', query: 'Milvus BM25', fields: ['id', 'text'], limit: 2 }, { signal: AbortSignal.timeout(1000) })
  assert.deepEqual(request, {
    collectionName: 'books', queryText: 'Milvus BM25', sparseField: 'sparse', outputFields: ['id', 'text'], limit: 2,
  })
  assert.deepEqual(result.rows, [{ distance: 2.4, id: 1, text: 'Milvus BM25' }])
  assert.equal(result.retrieval.mode, 'bm25')
  assert.equal(result.retrieval.routeSource, 'schema_unique')
  assert.equal(JSON.stringify(result.rows).includes('"sparse"'), false)
})

test('hybrid search defaults to RRF and maps explicit named weights to dense-first transport order', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const requests = []
  let embedCalls = 0
  const registered = []
  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => ({ id: 'local-dev', name: 'Local development', database: 'default' }),
    settingsFor: () => hybridSettings(),
    embeddingProvider: {
      embedQuery: async () => {
        embedCalls += 1
        return { kind: 'ready', vector: [0.1, 0.2, 0.3], provenance: { provider: 'openai', model: 'text-embedding-3-small', dimension: 3, latencyMs: 1 } }
      },
    },
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection: hybridCollection() }),
      hybridSearchCollection: async (value) => {
        requests.push(value)
        return { kind: 'ready', rows: [{ id: 1, text: 'combined', distance: 0.9 }] }
      },
    }),
  })
  const tool = registered.find((item) => item.name === 'milvus_hybrid_search')
  const base = { collection: 'books', query: 'hybrid retrieval', fields: ['id', 'text'], limit: 4 }
  const defaultResult = await tool.execute(base, { signal: AbortSignal.timeout(1000) })
  const weightedResult = await tool.execute({
    ...base, rerank: { strategy: 'weighted', denseWeight: 0.7, bm25Weight: 0.3 },
  }, { signal: AbortSignal.timeout(1000) })

  assert.equal(embedCalls, 2)
  assert.deepEqual(requests[0].rerank, { strategy: 'rrf', params: { k: 60 } })
  assert.deepEqual(requests[1].rerank, { strategy: 'weighted', params: { weights: [0.7, 0.3] } })
  assert.deepEqual(defaultResult.retrieval.rerank, { strategy: 'rrf', k: 60, source: 'plugin_default' })
  assert.deepEqual(weightedResult.retrieval.rerank, {
    strategy: 'weighted', denseWeight: 0.7, bm25Weight: 0.3, source: 'request',
  })
  assert.equal(JSON.stringify(weightedResult).includes('[0.1,0.2,0.3]'), false)
})

test('collection policies resolve capability ambiguity and remain the rerank default with an explicit text field', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const profile = { id: 'local-dev', name: 'Local development', database: 'default' }
  const baseCollection = hybridCollection()
  const secondRoute = {
    ...baseCollection.retrievalSchema.bm25Routes[0],
    functionName: 'title_bm25',
    inputField: 'title',
    outputField: 'title_sparse',
  }
  const collection = hybridCollection({
    fields: [
      ...baseCollection.fields,
      { name: 'title', dataType: 'VarChar', kind: 'scalar', primaryKey: false, analyzerEnabled: true },
      { name: 'title_sparse', dataType: 'SparseFloatVector', kind: 'vector', primaryKey: false, functionOutput: true },
    ],
    indexes: [
      ...baseCollection.indexes,
      { fieldName: 'title_sparse', indexName: 'title_sparse_idx', metricType: 'BM25' },
    ],
    retrievalSchema: {
      schemaFingerprint: 'sha256:multiple',
      bm25Routes: [...baseCollection.retrievalSchema.bm25Routes, secondRoute],
      unsupportedSparseFields: [],
    },
  })
  const settings = hybridSettings({
    retrievalPolicies: [{
      milvusProfileId: 'local-dev',
      collection: 'books',
      textField: 'title',
      sparseField: 'title_sparse',
      schemaFingerprint: 'sha256:multiple',
      rerank: { strategy: 'weighted', denseWeight: 0.6, bm25Weight: 0.4 },
    }],
  })
  const registered = []
  const hybridRequests = []
  registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
    bindingFor: () => profile,
    settingsFor: () => settings,
    embeddingProvider: {
      embedQuery: async () => ({
        kind: 'ready',
        vector: [0.1, 0.2, 0.3],
        provenance: { provider: 'openai', model: 'text-embedding-3-small', dimension: 3, latencyMs: 1 },
      }),
    },
    createTransport: () => ({
      preflightCollection: async () => ({ kind: 'ready', collection }),
      hybridSearchCollection: async (request) => {
        hybridRequests.push(request)
        return { kind: 'ready', rows: [] }
      },
    }),
  })

  const describe = registered.find((tool) => tool.name === 'milvus_describe_collection')
  const described = await describe.execute({ collection: 'books' }, { signal: AbortSignal.timeout(1000) })
  assert.deepEqual(described.collection.capabilities.bm25, {
    state: 'ready',
    routes: [secondRoute],
  })
  assert.deepEqual(described.collection.capabilities.hybrid, { state: 'ready' })

  settings.retrievalPolicies[0].schemaFingerprint = 'sha256:stale'
  const staleDescription = await describe.execute({ collection: 'books' }, { signal: AbortSignal.timeout(1000) })
  assert.deepEqual(staleDescription.collection.capabilities.bm25, {
    state: 'blocked',
    routes: collection.retrievalSchema.bm25Routes,
    blocker: 'retrieval_plan_stale',
  })
  assert.deepEqual(staleDescription.collection.capabilities.hybrid, {
    state: 'blocked',
    blockers: ['retrieval_plan_stale'],
  })
  settings.retrievalPolicies[0].schemaFingerprint = 'sha256:multiple'

  const hybrid = registered.find((tool) => tool.name === 'milvus_hybrid_search')
  const result = await hybrid.execute({
    collection: 'books',
    query: 'hybrid retrieval',
    textField: 'title',
    fields: ['id'],
  }, { signal: AbortSignal.timeout(1000) })
  assert.equal(hybridRequests[0].sparseField, 'title_sparse')
  assert.deepEqual(hybridRequests[0].rerank, { strategy: 'weighted', params: { weights: [0.6, 0.4] } })
  assert.deepEqual(result.retrieval.rerank, {
    strategy: 'weighted', denseWeight: 0.6, bm25Weight: 0.4, source: 'collection_policy',
  })
})

test('hybrid rerank and schema ambiguity fail closed before embedding or Milvus calls', async () => {
  const { registerMilvusTools } = await import('../milvus-tools.mjs')
  const profile = { id: 'local-dev', name: 'Local development', database: 'default' }
  const executeWith = async ({ collection = hybridCollection(), settings = hybridSettings(), args = {} } = {}) => {
    const registered = []
    let embedCalls = 0
    let searchCalls = 0
    registerMilvusTools({ tools: { register: (tool) => registered.push(tool) } }, {
      bindingFor: () => profile,
      settingsFor: () => settings,
      embeddingProvider: { embedQuery: async () => { embedCalls += 1; return { kind: 'ready', vector: [0, 0, 0], provenance: {} } } },
      createTransport: () => ({
        preflightCollection: async () => ({ kind: 'ready', collection }),
        hybridSearchCollection: async () => { searchCalls += 1; return { kind: 'ready', rows: [] } },
      }),
    })
    const result = await registered.find((item) => item.name === 'milvus_hybrid_search').execute({
      collection: 'books', query: 'query', fields: ['id'], ...args,
    }, { signal: AbortSignal.timeout(1000) })
    return { result, embedCalls, searchCalls }
  }

  const missingWeights = await executeWith({ args: { rerank: { strategy: 'weighted' } } })
  assert.equal(missingWeights.result.reason, 'invalid_rerank')
  assert.equal(missingWeights.embedCalls, 0)
  assert.equal(missingWeights.searchCalls, 0)

  const routes = hybridCollection().retrievalSchema.bm25Routes
  const ambiguous = await executeWith({
    collection: hybridCollection({
      retrievalSchema: {
        schemaFingerprint: 'sha256:multiple',
        bm25Routes: [...routes, { ...routes[0], functionName: 'title_bm25', inputField: 'title', outputField: 'title_sparse' }],
        unsupportedSparseFields: [],
      },
    }),
  })
  assert.equal(ambiguous.result.reason, 'bm25_route_ambiguous')
  assert.equal(ambiguous.embedCalls, 0)

  const unsupportedSparse = await executeWith({
    collection: hybridCollection({ retrievalSchema: { schemaFingerprint: 'sha256:none', bm25Routes: [], unsupportedSparseFields: ['sparse'] } }),
  })
  assert.equal(unsupportedSparse.result.reason, 'sparse_encoder_binding_absent')
  assert.equal(unsupportedSparse.embedCalls, 0)

  const stale = await executeWith({ settings: hybridSettings({
    retrievalPolicies: [{
      milvusProfileId: 'local-dev', collection: 'books', textField: 'text', sparseField: 'sparse',
      schemaFingerprint: 'sha256:old', rerank: { strategy: 'rrf', k: 90 },
    }],
  }) })
  assert.equal(stale.result.reason, 'retrieval_plan_stale')
  assert.equal(stale.embedCalls, 0)
})
