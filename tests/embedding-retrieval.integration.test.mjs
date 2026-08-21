import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpClient } from '@zilliz/milvus2-sdk-node'
import { createEmbeddingProvider } from '../embedding-provider.mjs'
import { registerMilvusTools } from '../milvus-tools.mjs'
import { createMilvusTransport } from '../milvus-transport.mjs'

const endpoint = process.env.MILVUS_TEST_ENDPOINT
const database = process.env.MILVUS_TEST_DATABASE ?? 'default'
const canMutate = process.env.MILVUS_TEST_ALLOW_MUTATION === '1'
const providerName = process.env.EMBEDDING_TEST_PROVIDER ?? 'gemini'
const providerConfig = providerName === 'openai'
  ? {
      provider: 'openai',
      model: 'text-embedding-3-small',
      credentialRef: 'OPENAI_API_KEY_EMBEDDING_ONLY',
      value: process.env.OPENAI_API_KEY_EMBEDDING_ONLY,
    }
  : {
      provider: 'gemini',
      model: 'gemini-embedding-001',
      credentialRef: 'GEMINI_API_KEY',
      value: process.env.GEMINI_API_KEY,
    }

test('a real provider query embedding reaches a disposable Milvus collection through milvus_search', {
  skip: endpoint && canMutate && providerConfig.value
    ? false
    : 'Set MILVUS_TEST_ENDPOINT, MILVUS_TEST_ALLOW_MUTATION=1, and the selected provider API key to run this full retrieval probe.',
}, async () => {
  const client = new HttpClient({ endpoint, database, timeout: 30_000 })
  const collectionName = `dsh_plugin_retrieval_probe_${Date.now()}_${process.pid}`
  const queryText = `DSH Milvus retrieval smoke ${collectionName}`
  const embeddingProfile = {
    id: 'integration-embedding',
    name: 'Integration embedding',
    provider: providerConfig.provider,
    model: providerConfig.model,
    credentialRef: providerConfig.credentialRef,
  }
  const embeddingProvider = createEmbeddingProvider({
    resolveCredential: async (ref) => ref === providerConfig.credentialRef
      ? { value: providerConfig.value }
      : undefined,
  })
  const embedded = await embeddingProvider.embedQuery({
    profile: embeddingProfile,
    text: queryText,
    dimensions: 128,
  })
  assert.equal(embedded.kind, 'ready', embedded.message)

  let created = false
  try {
    const createdResponse = await client.createCollection({
      collectionName,
      dbName: database,
      schema: {
        fields: [
          { fieldName: 'id', dataType: 'Int64', isPrimary: true },
          { fieldName: 'title', dataType: 'VarChar', elementTypeParams: { max_length: 128 } },
          { fieldName: 'embedding', dataType: 'FloatVector', elementTypeParams: { dim: 128 } },
        ],
      },
    })
    assert.equal(createdResponse.code, 0, createdResponse.message)
    created = true

    const inserted = await client.insert({
      collectionName,
      dbName: database,
      data: [{ id: 1, title: 'full retrieval fixture', embedding: embedded.vector }],
    })
    assert.equal(inserted.code, 0, inserted.message)
    assert.equal((await client.flushCollection({ collectionName, dbName: database })).code, 0)
    assert.equal((await client.createIndex({
      collectionName,
      dbName: database,
      indexParams: [{
        fieldName: 'embedding',
        indexName: 'embedding_idx',
        metricType: 'COSINE',
        params: { index_type: 'AUTOINDEX' },
      }],
    })).code, 0)
    assert.equal((await client.loadCollection({ collectionName, dbName: database })).code, 0)

    const milvusProfile = {
      id: 'integration-local',
      name: 'Integration local',
      kind: 'local',
      endpoint,
      database,
    }
    const transport = createMilvusTransport({
      profile: milvusProfile,
      resolveCredential: async () => undefined,
      createClient: (options) => new HttpClient(options),
    })
    const tools = []
    registerMilvusTools({ tools: { register: (tool) => tools.push(tool) } }, {
      bindingFor: () => milvusProfile,
      createTransport: () => transport,
      embeddingProvider,
      settingsFor: () => ({
        embeddingProfiles: [embeddingProfile],
        retrievalBindings: [{
          milvusProfileId: milvusProfile.id,
          collection: collectionName,
          vectorField: 'embedding',
          embeddingProfileId: embeddingProfile.id,
        }],
      }),
    })

    const result = await tools.find((tool) => tool.name === 'milvus_search').execute({
      collection: collectionName,
      query: queryText,
      fields: ['id', 'title'],
      limit: 1,
    }, { signal: AbortSignal.timeout(30_000) })

    assert.equal(result.kind, 'ready', result.message)
    assert.equal(result.rows.length, 1)
    assert.equal(result.rows[0].title, 'full retrieval fixture')
    assert.equal(result.retrieval.embedding.provider, providerConfig.provider)
    assert.equal(result.retrieval.embedding.dimension, 128)
    assert.equal(JSON.stringify(result).includes(providerConfig.value), false)
    assert.equal(JSON.stringify(result).includes('embedding":['), false)
  } finally {
    if (created) {
      await client.releaseCollection({ collectionName, dbName: database }).catch(() => undefined)
      const dropped = await client.dropCollection({ collectionName, dbName: database })
      assert.equal(dropped.code, 0, dropped.message)
    }
  }
})
