import assert from 'node:assert/strict'
import test from 'node:test'

const openAIProfile = {
  id: 'openai-small',
  provider: 'openai',
  model: 'text-embedding-3-small',
  credentialRef: 'DSH_EMBEDDING_OPENAI_SMALL_API_KEY',
}

const jsonResponse = (value, options = {}) => new Response(JSON.stringify(value), {
  status: options.status ?? 200,
  headers: { 'content-type': 'application/json', ...(options.headers ?? {}) },
})

test('OpenAI embeds query text at the collection dimension without disclosing its credential', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const provider = createEmbeddingProvider({
    resolveCredential: async (ref) => {
      assert.equal(ref, openAIProfile.credentialRef)
      return { value: 'secret-openai-key' }
    },
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({
        data: [{ embedding: [0.1, 0.2, 0.3] }],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      }, { headers: { 'x-request-id': 'req-safe' } })
    },
    now: (() => { let value = 100; return () => value += 5 })(),
  })

  const result = await provider.embedQuery({
    profile: openAIProfile,
    text: 'Milvus indexing',
    dimensions: 3,
  })

  assert.equal(request.url, 'https://api.openai.com/v1/embeddings')
  assert.equal(request.init.headers.authorization, 'Bearer secret-openai-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    input: 'Milvus indexing',
    model: 'text-embedding-3-small',
    encoding_format: 'float',
    dimensions: 3,
  })
  assert.deepEqual(result, {
    kind: 'ready',
    vector: [0.1, 0.2, 0.3],
    provenance: {
      provider: 'openai',
      model: 'text-embedding-3-small',
      dimension: 3,
      latencyMs: 5,
      usage: { promptTokens: 4, totalTokens: 4 },
      requestId: 'req-safe',
    },
  })
  assert.equal(JSON.stringify(result).includes('secret-openai-key'), false)
})

test('Gemini 001 sends retrieval-query intent and normalizes reduced-dimensional output', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const profile = {
    id: 'gemini-main',
    provider: 'gemini',
    model: 'gemini-embedding-001',
    credentialRef: 'DSH_EMBEDDING_GEMINI_MAIN_API_KEY',
  }
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret-gemini-key' }),
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ embedding: { values: [3, 4] } })
    },
    now: () => 100,
  })

  const result = await provider.embedQuery({ profile, text: 'vector databases', dimensions: 2 })

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent')
  assert.equal(request.init.headers['x-goog-api-key'], 'secret-gemini-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    content: { parts: [{ text: 'vector databases' }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: 2,
  })
  assert.equal(result.kind, 'ready')
  assert.deepEqual(result.vector, [0.6, 0.8])
  assert.deepEqual(result.provenance, {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dimension: 2,
    latencyMs: 0,
  })
})

test('Gemini 2 uses the documented retrieval query prefix and keeps provider normalization', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let body
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return jsonResponse({ embedding: { values: [2, 0] } })
    },
  })
  const result = await provider.embedQuery({
    profile: {
      id: 'gemini-2',
      provider: 'gemini',
      model: 'gemini-embedding-2',
      credentialRef: 'DSH_EMBEDDING_GEMINI_2_API_KEY',
    },
    text: 'hybrid search',
    dimensions: 2,
  })

  assert.deepEqual(body, {
    content: { parts: [{ text: 'task: search result | query: hybrid search' }] },
    outputDimensionality: 2,
  })
  assert.deepEqual(result.vector, [2, 0])
})

test('embedding is fail-closed for missing credentials, provider errors, and dimension mismatch', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let fetchCalls = 0
  const missing = createEmbeddingProvider({
    resolveCredential: async () => undefined,
    fetchImpl: async () => { fetchCalls += 1 },
  })
  assert.deepEqual(await missing.embedQuery({ profile: openAIProfile, text: 'query', dimensions: 2 }), {
    kind: 'blocked',
    reason: 'embedding_credential_unavailable',
    message: 'The embedding profile credential is unavailable.',
  })
  assert.equal(fetchCalls, 0)

  for (const [status, reason] of [[401, 'embedding_auth_rejected'], [429, 'embedding_rate_limited'], [404, 'embedding_model_unavailable'], [500, 'embedding_provider_unavailable']]) {
    const failed = createEmbeddingProvider({
      resolveCredential: async () => ({ value: 'secret' }),
      fetchImpl: async () => jsonResponse({ error: { message: 'sensitive upstream detail' } }, { status }),
    })
    const result = await failed.embedQuery({ profile: openAIProfile, text: 'query', dimensions: 2 })
    assert.equal(result.reason, reason)
    assert.equal(JSON.stringify(result).includes('sensitive upstream detail'), false)
  }

  const mismatch = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret' }),
    fetchImpl: async () => jsonResponse({ data: [{ embedding: [1] }] }),
  })
  assert.equal((await mismatch.embedQuery({ profile: openAIProfile, text: 'query', dimensions: 2 })).reason, 'embedding_dimension_mismatch')
})
