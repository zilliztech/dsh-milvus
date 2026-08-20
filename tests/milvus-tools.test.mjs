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
