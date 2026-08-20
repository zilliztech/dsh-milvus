import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpClient } from '@zilliz/milvus2-sdk-node'
import { createMilvusTransport } from '../milvus-transport.mjs'
import { registerMilvusTools } from '../milvus-tools.mjs'

const endpoint = process.env.MILVUS_TEST_ENDPOINT
const database = process.env.MILVUS_TEST_DATABASE ?? 'default'
const canMutate = process.env.MILVUS_TEST_ALLOW_MUTATION === '1'

test('the official HTTP SDK supports the v0.1 read path on a disposable collection', {
  skip: endpoint && canMutate
    ? false
    : 'Set MILVUS_TEST_ENDPOINT and MILVUS_TEST_ALLOW_MUTATION=1 to run this disposable write-and-cleanup probe.',
}, async () => {
  const client = new HttpClient({ endpoint, database, timeout: 30_000 })
  const collectionName = `dsh_plugin_sdk_probe_${Date.now()}_${process.pid}`
  let created = false

  try {
    const createdResponse = await client.createCollection({
      collectionName,
      dbName: database,
      schema: {
        fields: [
          { fieldName: 'id', dataType: 'Int64', isPrimary: true },
          { fieldName: 'title', dataType: 'VarChar', elementTypeParams: { max_length: 128 } },
          { fieldName: 'embedding', dataType: 'FloatVector', elementTypeParams: { dim: 2 } },
        ],
      },
    })
    assert.equal(createdResponse.code, 0, createdResponse.message)
    created = true

    const inserted = await client.insert({
      collectionName,
      dbName: database,
      data: [
        { id: 1, title: 'fixture one', embedding: [0, 0] },
        { id: 2, title: 'fixture two', embedding: [1, 1] },
      ],
    })
    assert.equal(inserted.code, 0, inserted.message)

    const flushed = await client.flushCollection({ collectionName, dbName: database })
    assert.equal(flushed.code, 0, flushed.message)

    const indexed = await client.createIndex({
      collectionName,
      dbName: database,
      indexParams: [{
        fieldName: 'embedding',
        indexName: 'embedding_idx',
        metricType: 'L2',
        params: { index_type: 'AUTOINDEX' },
      }],
    })
    assert.equal(indexed.code, 0, indexed.message)

    const loaded = await client.loadCollection({ collectionName, dbName: database })
    assert.equal(loaded.code, 0, loaded.message)

    const transport = createMilvusTransport({
      profile: {
        id: 'integration-local',
        name: 'Integration local',
        kind: 'local',
        endpoint,
        database,
      },
      resolveCredential: async () => undefined,
      createClient: (options) => new HttpClient(options),
    })
    const preflight = await transport.preflightCollection(collectionName)
    assert.equal(preflight.kind, 'ready', preflight.message)
    assert.equal(preflight.collection.name, collectionName)
    assert.ok(preflight.collection.fields.some((field) => field.name === 'title' && field.kind === 'scalar'))
    assert.ok(preflight.collection.fields.some((field) => field.name === 'embedding' && field.kind === 'vector'))

    const registeredTools = []
    registerMilvusTools({ tools: { register: (tool) => registeredTools.push(tool) } }, {
      bindingFor: () => ({
        id: 'integration-local',
        name: 'Integration local',
        kind: 'local',
        endpoint,
        database,
      }),
      createTransport: () => transport,
    })
    const queryTool = registeredTools.find((tool) => tool.name === 'milvus_query')
    const controlledQuery = await queryTool.execute({
      collection: collectionName,
      filter: 'id >= 0',
      fields: ['id', 'title'],
      limit: 1,
    }, { signal: AbortSignal.timeout(30_000) })
    assert.equal(controlledQuery.kind, 'ready')
    assert.equal(controlledQuery.rows.length, 1)
    assert.equal(controlledQuery.rows[0].embedding, undefined)
    assert.equal(typeof controlledQuery.rows[0].title, 'string')

    const description = await client.describeCollection({ collectionName, dbName: database })
    assert.equal(description.code, 0, description.message)
    assert.equal(description.data.collectionName, collectionName)

    const statistics = await client.getCollectionStatistics({ collectionName, dbName: database })
    assert.equal(statistics.code, 0, statistics.message)

    const query = await client.query({
      collectionName,
      dbName: database,
      filter: 'id >= 0',
      outputFields: ['title'],
      limit: 1,
    })
    assert.equal(query.code, 0, query.message)
    assert.equal(query.data.length, 1)
    assert.equal(query.data[0].embedding, undefined)
    assert.equal(typeof query.data[0].title, 'string')
  } finally {
    if (created) {
      await client.releaseCollection({ collectionName, dbName: database }).catch(() => undefined)
      const dropped = await client.dropCollection({ collectionName, dbName: database })
      assert.equal(dropped.code, 0, dropped.message)

      const exists = await client.hasCollection({ collectionName, dbName: database })
      assert.equal(exists.code, 0, exists.message)
      assert.equal(exists.data.has, false)
    }
  }
})
