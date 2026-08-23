import assert from 'node:assert/strict'
import test from 'node:test'

import {
  EMBEDDING_PROVIDER_CATALOG,
  EMBEDDING_PROVIDERS,
  embeddingModelsFor,
  validateEmbeddingModelDimension,
} from '../embedding-models.mjs'

test('the curated catalog exposes seven providers with at least one exact model', () => {
  assert.deepEqual(EMBEDDING_PROVIDERS, [
    'openai',
    'gemini',
    'cohere',
    'voyage',
    'mistral',
    'jina',
    'together',
  ])
  for (const provider of EMBEDDING_PROVIDERS) {
    const definition = EMBEDDING_PROVIDER_CATALOG[provider]
    assert.ok(definition.label)
    assert.ok(embeddingModelsFor(provider).includes(definition.defaultModel))
  }
  assert.deepEqual(Object.fromEntries(EMBEDDING_PROVIDERS.map((provider) => [
    provider,
    embeddingModelsFor(provider).length,
  ])), {
    openai: 3,
    gemini: 2,
    cohere: 5,
    voyage: 9,
    mistral: 2,
    jina: 6,
    together: 1,
  })
})

test('range, discrete, and fixed model dimensions fail closed exactly', () => {
  const cases = [
    ['openai', 'text-embedding-3-small', 1_536, 1_537],
    ['openai', 'text-embedding-ada-002', 1_536, 1_024],
    ['gemini', 'gemini-embedding-2', 128, 64],
    ['cohere', 'embed-v4.0', 512, 768],
    ['cohere', 'embed-english-light-v3.0', 384, 1_024],
    ['voyage', 'voyage-4', 2_048, 1_536],
    ['voyage', 'voyage-finance-2', 1_024, 2_048],
    ['mistral', 'mistral-embed', 1_024, 768],
    ['mistral', 'codestral-embed', 384, 3_073],
    ['jina', 'jina-embeddings-v5-text-small', 768, 384],
    ['jina', 'jina-embeddings-v4', 2_048, 64],
    ['jina', 'jina-embeddings-v3', 32, 2_048],
    ['together', 'intfloat/multilingual-e5-large-instruct', 1_024, 768],
  ]

  for (const [provider, model, supported, unsupported] of cases) {
    assert.equal(validateEmbeddingModelDimension({ provider, model }, supported), undefined)
    assert.equal(validateEmbeddingModelDimension({ provider, model }, unsupported)?.reason, 'unsupported_vector_dimension')
  }
})

test('unknown providers and models are rejected without a fallback', () => {
  assert.equal(validateEmbeddingModelDimension({ provider: 'custom', model: 'anything' }, 1_024)?.reason, 'embedding_provider_unsupported')
  assert.equal(validateEmbeddingModelDimension({ provider: 'cohere', model: 'future-model' }, 1_024)?.reason, 'embedding_model_unsupported')
})
