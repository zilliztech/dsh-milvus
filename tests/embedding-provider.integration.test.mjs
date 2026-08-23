import assert from 'node:assert/strict'
import test from 'node:test'

import { createEmbeddingProvider } from '../embedding-provider.mjs'

const cases = [
  {
    provider: 'openai',
    model: 'text-embedding-3-small',
    dimensions: 128,
    keyName: 'OPENAI_API_KEY',
  },
  {
    provider: 'gemini',
    model: 'gemini-embedding-2',
    dimensions: 128,
    keyName: process.env.GEMINI_API_KEY ? 'GEMINI_API_KEY' : 'GOOGLE_API_KEY',
  },
  {
    provider: 'cohere',
    model: 'embed-v4.0',
    dimensions: 256,
    keyName: 'COHERE_API_KEY',
  },
  {
    provider: 'cohere',
    model: 'embed-multilingual-light-v3.0',
    dimensions: 384,
    keyName: 'COHERE_API_KEY',
  },
  {
    provider: 'voyage',
    model: 'voyage-4',
    dimensions: 256,
    keyName: 'VOYAGE_API_KEY',
  },
  {
    provider: 'voyage',
    model: 'voyage-3.5',
    dimensions: 256,
    keyName: 'VOYAGE_API_KEY',
  },
  {
    provider: 'voyage',
    model: 'voyage-law-2',
    dimensions: 1_024,
    keyName: 'VOYAGE_API_KEY',
  },
  {
    provider: 'mistral',
    model: 'mistral-embed',
    dimensions: 1_024,
    keyName: 'MISTRAL_API_KEY',
  },
  {
    provider: 'jina',
    model: 'jina-embeddings-v5-text-small',
    dimensions: 128,
    keyName: 'JINA_API_KEY',
  },
  {
    provider: 'together',
    model: 'intfloat/multilingual-e5-large-instruct',
    dimensions: 1_024,
    keyName: 'TOGETHER_API_KEY',
  },
]

for (const entry of cases) {
  const credential = process.env[entry.keyName]
  const networkAllowed = process.env.EMBEDDING_TEST_ALLOW_NETWORK === '1'
  test(`the real ${entry.provider}/${entry.model} API returns a compatible query embedding`, {
    skip: !networkAllowed
      ? 'Set EMBEDDING_TEST_ALLOW_NETWORK=1 to allow real provider calls.'
      : credential
        ? false
        : `Set ${entry.keyName} to run this provider smoke test.`,
  }, async () => {
    const credentialRef = `TEST_${entry.provider.toUpperCase()}_API_KEY`
    const provider = createEmbeddingProvider({
      resolveCredential: async (ref) => ref === credentialRef ? { value: credential } : undefined,
      timeoutMs: 30_000,
    })
    const result = await provider.embedQuery({
      profile: {
        id: `${entry.provider}-smoke`,
        provider: entry.provider,
        model: entry.model,
        credentialRef,
      },
      text: 'How does vector search work?',
      dimensions: entry.dimensions,
    })

    assert.equal(result.kind, 'ready', `${entry.provider} failed with ${result.reason ?? 'an unknown outcome'}`)
    assert.equal(result.vector.length, entry.dimensions)
    assert.equal(result.provenance.provider, entry.provider)
    assert.equal(result.provenance.model, entry.model)
    assert.equal(JSON.stringify(result.provenance).includes(credential), false)
  })
}
