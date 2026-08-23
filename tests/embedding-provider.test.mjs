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

const vectorOf = (dimensions, values = [0.25]) => Array.from({ length: dimensions }, (_, index) => values[index] ?? 0)

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

test('OpenAI Ada 002 uses its fixed output without sending the dimensions parameter', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let body
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return jsonResponse({ data: [{ embedding: vectorOf(1_536) }] })
    },
  })

  const result = await provider.embedQuery({
    profile: {
      id: 'openai-ada',
      provider: 'openai',
      model: 'text-embedding-ada-002',
      credentialRef: 'OPENAI_API_KEY',
    },
    text: 'legacy vector space',
    dimensions: 1_536,
  })

  assert.deepEqual(body, {
    input: 'legacy vector space',
    model: 'text-embedding-ada-002',
    encoding_format: 'float',
  })
  assert.equal(result.vector.length, 1_536)
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
      return jsonResponse({ embedding: { values: vectorOf(128, [3, 4]) } })
    },
    now: () => 100,
  })

  const result = await provider.embedQuery({ profile, text: 'vector databases', dimensions: 128 })

  assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent')
  assert.equal(request.init.headers['x-goog-api-key'], 'secret-gemini-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    content: { parts: [{ text: 'vector databases' }] },
    taskType: 'RETRIEVAL_QUERY',
    outputDimensionality: 128,
  })
  assert.equal(result.kind, 'ready')
  assert.equal(result.vector.length, 128)
  assert.deepEqual(result.vector.slice(0, 2), [0.6, 0.8])
  assert.deepEqual(result.provenance, {
    provider: 'gemini',
    model: 'gemini-embedding-001',
    dimension: 128,
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
      return jsonResponse({ embedding: { values: vectorOf(128, [2, 0]) } })
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
    dimensions: 128,
  })

  assert.deepEqual(body, {
    content: { parts: [{ text: 'task: search result | query: hybrid search' }] },
    outputDimensionality: 128,
  })
  assert.equal(result.vector.length, 128)
  assert.deepEqual(result.vector.slice(0, 2), [2, 0])
})

test('Cohere v2 sends search-query intent and extracts float embeddings', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const profile = {
    id: 'cohere-v4',
    provider: 'cohere',
    model: 'embed-v4.0',
    credentialRef: 'COHERE_API_KEY',
  }
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret-cohere-key' }),
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ embeddings: { float: [vectorOf(256)] } })
    },
  })

  const result = await provider.embedQuery({ profile, text: 'Milvus query', dimensions: 256 })

  assert.equal(request.url, 'https://api.cohere.com/v2/embed')
  assert.equal(request.init.headers.authorization, 'Bearer secret-cohere-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    model: 'embed-v4.0',
    texts: ['Milvus query'],
    input_type: 'search_query',
    output_dimension: 256,
    embedding_types: ['float'],
  })
  assert.equal(result.kind, 'ready')
  assert.equal(result.vector.length, 256)
})

test('Cohere Embed v3 keeps its fixed dimension implicit', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let body
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return jsonResponse({ embeddings: { float: [vectorOf(384)] } })
    },
  })

  const result = await provider.embedQuery({
    profile: {
      id: 'cohere-v3-light',
      provider: 'cohere',
      model: 'embed-multilingual-light-v3.0',
      credentialRef: 'COHERE_API_KEY',
    },
    text: 'Milvus query',
    dimensions: 384,
  })

  assert.deepEqual(body, {
    model: 'embed-multilingual-light-v3.0',
    texts: ['Milvus query'],
    input_type: 'search_query',
    embedding_types: ['float'],
  })
  assert.equal(result.vector.length, 384)
})

test('Voyage v1 requests a float query embedding at a supported dimension', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const profile = {
    id: 'voyage-main',
    provider: 'voyage',
    model: 'voyage-4',
    credentialRef: 'VOYAGE_API_KEY',
  }
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret-voyage-key' }),
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ data: [{ embedding: vectorOf(512) }], usage: { total_tokens: 3 } })
    },
  })

  const result = await provider.embedQuery({ profile, text: 'Milvus query', dimensions: 512 })

  assert.equal(request.url, 'https://api.voyageai.com/v1/embeddings')
  assert.equal(request.init.headers.authorization, 'Bearer secret-voyage-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    input: 'Milvus query',
    model: 'voyage-4',
    input_type: 'query',
    truncation: false,
    output_dimension: 512,
    output_dtype: 'float',
  })
  assert.equal(result.vector.length, 512)
  assert.deepEqual(result.provenance.usage, { totalTokens: 3 })
})

test('Voyage domain models keep their fixed output dimension implicit', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let body
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return jsonResponse({ data: [{ embedding: vectorOf(1_024) }] })
    },
  })

  const result = await provider.embedQuery({
    profile: {
      id: 'voyage-law',
      provider: 'voyage',
      model: 'voyage-law-2',
      credentialRef: 'VOYAGE_API_KEY',
    },
    text: 'Milvus query',
    dimensions: 1_024,
  })

  assert.deepEqual(body, {
    input: 'Milvus query',
    model: 'voyage-law-2',
    input_type: 'query',
    truncation: false,
    output_dtype: 'float',
  })
  assert.equal(result.vector.length, 1_024)
})

test('Mistral uses the production embeddings API without dimension overrides for mistral-embed', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const profile = {
    id: 'mistral-main',
    provider: 'mistral',
    model: 'mistral-embed',
    credentialRef: 'MISTRAL_API_KEY',
  }
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret-mistral-key' }),
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ data: [{ embedding: vectorOf(1_024) }], usage: { prompt_tokens: 2, total_tokens: 2 } })
    },
  })

  const result = await provider.embedQuery({ profile, text: 'Milvus query', dimensions: 1_024 })

  assert.equal(request.url, 'https://api.mistral.ai/v1/embeddings')
  assert.equal(request.init.headers.authorization, 'Bearer secret-mistral-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    input: ['Milvus query'],
    model: 'mistral-embed',
    encoding_format: 'float',
  })
  assert.equal(result.vector.length, 1_024)
  assert.deepEqual(result.provenance.usage, { promptTokens: 2, totalTokens: 2 })
})

test('Codestral Embed sends its documented variable output dimension', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let body
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret' }),
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body)
      return jsonResponse({ data: [{ embedding: vectorOf(384) }] })
    },
  })

  const result = await provider.embedQuery({
    profile: {
      id: 'codestral-main',
      provider: 'mistral',
      model: 'codestral-embed',
      credentialRef: 'MISTRAL_API_KEY',
    },
    text: 'function vectorSearch() {}',
    dimensions: 384,
  })

  assert.deepEqual(body, {
    input: ['function vectorSearch() {}'],
    model: 'codestral-embed',
    encoding_format: 'float',
    output_dimension: 384,
    output_dtype: 'float',
  })
  assert.equal(result.vector.length, 384)
})

test('Jina v5 selects retrieval.query and a normalized Matryoshka dimension', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const profile = {
    id: 'jina-main',
    provider: 'jina',
    model: 'jina-embeddings-v5-text-small',
    credentialRef: 'JINA_API_KEY',
  }
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret-jina-key' }),
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ data: [{ embedding: vectorOf(768) }], usage: { total_tokens: 4 } })
    },
  })

  const result = await provider.embedQuery({ profile, text: 'Milvus query', dimensions: 768 })

  assert.equal(request.url, 'https://api.jina.ai/v1/embeddings')
  assert.equal(request.init.headers.authorization, 'Bearer secret-jina-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    input: ['Milvus query'],
    model: 'jina-embeddings-v5-text-small',
    task: 'retrieval.query',
    dimensions: 768,
    normalized: true,
    embedding_type: 'float',
  })
  assert.equal(result.vector.length, 768)
  assert.deepEqual(result.provenance.usage, { totalTokens: 4 })
})

test('Together uses its current OpenAI-compatible production endpoint and fixed model dimension', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let request
  const profile = {
    id: 'together-main',
    provider: 'together',
    model: 'intfloat/multilingual-e5-large-instruct',
    credentialRef: 'TOGETHER_API_KEY',
  }
  const provider = createEmbeddingProvider({
    resolveCredential: async () => ({ value: 'secret-together-key' }),
    fetchImpl: async (url, init) => {
      request = { url, init }
      return jsonResponse({ data: [{ embedding: vectorOf(1_024) }] })
    },
  })

  const result = await provider.embedQuery({ profile, text: 'Milvus query', dimensions: 1_024 })

  assert.equal(request.url, 'https://api.together.ai/v1/embeddings')
  assert.equal(request.init.headers.authorization, 'Bearer secret-together-key')
  assert.deepEqual(JSON.parse(request.init.body), {
    input: 'Milvus query',
    model: 'intfloat/multilingual-e5-large-instruct',
  })
  assert.equal(result.vector.length, 1_024)
})

test('model dimension incompatibility fails before credential resolution or provider I/O', async () => {
  const { createEmbeddingProvider } = await import('../embedding-provider.mjs')
  let credentialCalls = 0
  let fetchCalls = 0
  const provider = createEmbeddingProvider({
    resolveCredential: async () => { credentialCalls += 1; return { value: 'secret' } },
    fetchImpl: async () => { fetchCalls += 1 },
  })
  const result = await provider.embedQuery({
    profile: {
      id: 'together-main',
      provider: 'together',
      model: 'intfloat/multilingual-e5-large-instruct',
      credentialRef: 'TOGETHER_API_KEY',
    },
    text: 'query',
    dimensions: 768,
  })

  assert.deepEqual(result, {
    kind: 'blocked',
    reason: 'unsupported_vector_dimension',
    message: 'The configured embedding model cannot produce the target Milvus vector dimension.',
  })
  assert.equal(credentialCalls, 0)
  assert.equal(fetchCalls, 0)
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

  for (const [status, reason] of [[401, 'embedding_auth_rejected'], [498, 'embedding_auth_rejected'], [429, 'embedding_rate_limited'], [404, 'embedding_model_unavailable'], [500, 'embedding_provider_unavailable']]) {
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
