import assert from 'node:assert/strict'
import test from 'node:test'

test('embedding connection check returns only a safe ready status', async () => {
  const { checkEmbeddingProfile } = await import('../embedding-check.mjs')
  let request
  const result = await checkEmbeddingProfile({
    id: 'openai-small',
    provider: 'openai',
    model: 'text-embedding-3-small',
    credentialRef: 'DSH_EMBEDDING_OPENAI_API_KEY',
  }, {
    resolveCredential: async () => ({ value: 'secret' }),
    providerFactory: ({ resolveCredential }) => ({
      embedQuery: async (next) => {
        request = next
        assert.equal((await resolveCredential('DSH_EMBEDDING_OPENAI_API_KEY')).value, 'secret')
        return { kind: 'ready', vector: Array(128).fill(0), provenance: {} }
      },
    }),
    now: () => 123,
  })

  assert.equal(request.dimensions, 128)
  assert.deepEqual(result, {
    profileId: 'openai-small',
    checkedAt: 123,
    state: 'ready',
    message: 'Connected to the embedding provider.',
  })
  assert.equal(JSON.stringify(result).includes('secret'), false)
})

test('embedding connection check distinguishes an unavailable key without returning provider details', async () => {
  const { checkEmbeddingProfile } = await import('../embedding-check.mjs')
  const result = await checkEmbeddingProfile({ id: 'gemini', provider: 'gemini', model: 'gemini-embedding-001' }, {
    providerFactory: () => ({
      embedQuery: async () => ({
        kind: 'blocked',
        reason: 'embedding_credential_unavailable',
        message: 'sensitive internal detail',
      }),
    }),
    now: () => 55,
  })

  assert.deepEqual(result, {
    profileId: 'gemini',
    checkedAt: 55,
    state: 'blocked',
    message: 'The configured embedding API key is unavailable.',
  })
})
