import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpClient } from '@zilliz/milvus2-sdk-node'
import { registerMilvusTools } from '../milvus-tools.mjs'
import { createMilvusTransport } from '../milvus-transport.mjs'

const endpoint = process.env.MILVUS_TEST_ENDPOINT
const database = process.env.MILVUS_TEST_DATABASE ?? 'default'
const canMutate = process.env.MILVUS_TEST_ALLOW_MUTATION === '1'
const existingBm25Collection = process.env.MILVUS_TEST_BM25_COLLECTION ?? 'mfs_scale_2000'

function registeredTools({ profile, transport, settings, embeddingProvider }) {
  const tools = []
  registerMilvusTools({ tools: { register: (tool) => tools.push(tool) } }, {
    bindingFor: () => profile,
    createTransport: () => transport,
    settingsFor: () => settings,
    embeddingProvider,
  })
  return tools
}

test('milvus_text_search discovers and searches an existing real BM25 Function route without embeddings', {
  skip: endpoint ? false : 'Set MILVUS_TEST_ENDPOINT to run the real read-only BM25 probe.',
}, async () => {
  const profile = { id: 'integration-local', name: 'Integration local', kind: 'local', endpoint, database }
  const transport = createMilvusTransport({
    profile,
    resolveCredential: async () => undefined,
    createClient: (options) => new HttpClient(options),
  })
  const tools = registeredTools({ profile, transport, settings: {} })
  const described = await tools.find((tool) => tool.name === 'milvus_describe_collection').execute({
    collection: existingBm25Collection,
  }, { signal: AbortSignal.timeout(30_000) })
  assert.equal(described.kind, 'ready', described.message)
  assert.equal(described.collection.capabilities.bm25.state, 'ready')

  const result = await tools.find((tool) => tool.name === 'milvus_text_search').execute({
    collection: existingBm25Collection,
    query: 'retrieval',
    fields: ['id'],
    limit: 2,
  }, { signal: AbortSignal.timeout(30_000) })
  assert.equal(result.kind, 'ready', result.message)
  assert.ok(result.rows.length > 0)
  assert.equal(result.retrieval.mode, 'bm25')
  assert.equal(result.retrieval.bm25.metricType, 'BM25')
})

test('milvus_hybrid_search runs real RRF and Weighted dense-plus-BM25 retrieval on a disposable collection', {
  skip: endpoint && canMutate
    ? false
    : 'Set MILVUS_TEST_ENDPOINT and MILVUS_TEST_ALLOW_MUTATION=1 to run the disposable hybrid probe.',
}, async () => {
  const client = new HttpClient({ endpoint, database, timeout: 30_000 })
  const collectionName = `dsh_plugin_hybrid_probe_${Date.now()}_${process.pid}`
  let created = false
  try {
    const response = await client.createCollection({
      collectionName,
      dbName: database,
      schema: {
        autoID: false,
        enabledDynamicField: false,
        fields: [
          { fieldName: 'id', dataType: 'Int64', isPrimary: true },
          { fieldName: 'text', dataType: 'VarChar', elementTypeParams: { max_length: 1024, enable_analyzer: true } },
          { fieldName: 'dense', dataType: 'FloatVector', elementTypeParams: { dim: 3 } },
          { fieldName: 'sparse', dataType: 'SparseFloatVector' },
        ],
        functions: [{
          name: 'text_bm25',
          type: 'BM25',
          inputFieldNames: ['text'],
          outputFieldNames: ['sparse'],
          params: {},
        }],
      },
      indexParams: [
        { fieldName: 'dense', indexName: 'dense_idx', indexType: 'AUTOINDEX', metricType: 'COSINE' },
        { fieldName: 'sparse', indexName: 'sparse_idx', indexType: 'SPARSE_INVERTED_INDEX', metricType: 'BM25', params: { inverted_index_algo: 'DAAT_MAXSCORE' } },
      ],
    })
    assert.equal(response.code, 0, response.message)
    created = true

    const inserted = await client.insert({
      collectionName,
      dbName: database,
      data: [
        { id: 1, text: 'Milvus hybrid retrieval combines dense semantics and exact BM25 terms.', dense: [1, 0, 0] },
        { id: 2, text: 'A completely unrelated cooking recipe.', dense: [0, 1, 0] },
      ],
    })
    assert.equal(inserted.code, 0, inserted.message)
    assert.equal((await client.flushCollection({ collectionName, dbName: database })).code, 0)
    assert.equal((await client.loadCollection({ collectionName, dbName: database })).code, 0)

    const profile = { id: 'integration-local', name: 'Integration local', kind: 'local', endpoint, database }
    const transport = createMilvusTransport({
      profile,
      resolveCredential: async () => undefined,
      createClient: (options) => new HttpClient(options),
    })
    const settings = {
      embeddingProfiles: [{
        id: 'fixture-embedding', name: 'Fixture embedding', provider: 'openai', model: 'fixture', credentialRef: 'FIXTURE_ONLY',
      }],
      retrievalBindings: [{
        milvusProfileId: profile.id, collection: collectionName, vectorField: 'dense', embeddingProfileId: 'fixture-embedding',
      }],
    }
    const tools = registeredTools({
      profile,
      transport,
      settings,
      embeddingProvider: {
        embedQuery: async () => ({
          kind: 'ready', vector: [1, 0, 0],
          provenance: { provider: 'openai', model: 'fixture', dimension: 3, latencyMs: 0 },
        }),
      },
    })
    const hybrid = tools.find((tool) => tool.name === 'milvus_hybrid_search')
    const args = { collection: collectionName, query: 'Milvus hybrid retrieval BM25', fields: ['id', 'text'], limit: 2 }

    const rrf = await hybrid.execute(args, { signal: AbortSignal.timeout(30_000) })
    assert.equal(rrf.kind, 'ready', rrf.message)
    assert.equal(String(rrf.rows[0].id), '1')
    assert.deepEqual(rrf.retrieval.rerank, { strategy: 'rrf', k: 60, source: 'plugin_default' })

    const weighted = await hybrid.execute({
      ...args,
      rerank: { strategy: 'weighted', denseWeight: 0.7, bm25Weight: 0.3 },
    }, { signal: AbortSignal.timeout(30_000) })
    assert.equal(weighted.kind, 'ready', weighted.message)
    assert.equal(String(weighted.rows[0].id), '1')
    assert.deepEqual(weighted.retrieval.rerank, {
      strategy: 'weighted', denseWeight: 0.7, bm25Weight: 0.3, source: 'request',
    })
    assert.equal(JSON.stringify(weighted).includes('"dense":['), false)
    assert.equal(JSON.stringify(weighted.rows).includes('"sparse"'), false)
  } finally {
    if (created) {
      await client.releaseCollection({ collectionName, dbName: database }).catch(() => undefined)
      const dropped = await client.dropCollection({ collectionName, dbName: database })
      assert.equal(dropped.code, 0, dropped.message)
    }
  }
})
