import assert from 'node:assert/strict'
import test from 'node:test'

const localProfile = {
  id: 'local-dev',
  name: 'Local development',
  kind: 'local',
  endpoint: 'http://127.0.0.1:19530',
  database: 'default',
}

test('a selected Local profile has a fixed endpoint and database without a secret', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const settings = {
    profiles: [localProfile],
    activeProfileId: 'local-dev',
  }

  assert.doesNotThrow(() => validateProfileSettings(settings))
  assert.equal(JSON.stringify(settings).includes('token'), false)
})

test('a Cloud profile may omit its database while referring to a credential without embedding its value in settings', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const settings = {
    profiles: [{
      id: 'cloud-prod',
      name: 'Zilliz Cloud',
      kind: 'zilliz-cloud',
      endpoint: 'https://in01-example.cloud.zilliz.com',
      credentialRef: 'DSH_MILVUS_CLOUD_PROD_TOKEN',
    }],
    activeProfileId: 'cloud-prod',
  }

  assert.doesNotThrow(() => validateProfileSettings(settings))
  assert.equal(settings.profiles[0].credentialRef, 'DSH_MILVUS_CLOUD_PROD_TOKEN')
  assert.equal(Object.hasOwn(settings.profiles[0], 'token'), false)
})

test('profile settings reject unsafe or ambiguous configuration before persistence', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')

  assert.throws(() => validateProfileSettings({
    profiles: [{ ...localProfile, token: 'must-not-be-here' }],
    activeProfileId: 'local-dev',
  }), /secret/i)

  assert.throws(() => validateProfileSettings({
    profiles: [localProfile],
    activeProfileId: 'missing-profile',
  }), /active profile/i)

  assert.throws(() => validateProfileSettings({
    profiles: [{
      id: 'cloud-over-http',
      name: 'Cloud over HTTP',
      kind: 'zilliz-cloud',
      endpoint: 'http://cloud.example.com',
      database: 'default',
      credentialRef: 'DSH_MILVUS_CLOUD_TOKEN',
    }],
    activeProfileId: 'cloud-over-http',
  }), /https/i)
})

test('embedding profiles and retrieval bindings contain references but no API key values', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const settings = {
    profiles: [localProfile],
    activeProfileId: 'local-dev',
    embeddingProfiles: [{
      id: 'openai-small',
      name: 'OpenAI small',
      provider: 'openai',
      model: 'text-embedding-3-small',
      credentialRef: 'DSH_EMBEDDING_OPENAI_SMALL_API_KEY',
    }],
    retrievalBindings: [{
      milvusProfileId: 'local-dev',
      collection: 'documents',
      vectorField: 'embedding',
      embeddingProfileId: 'openai-small',
    }],
  }

  assert.doesNotThrow(() => validateProfileSettings(settings))
  assert.equal(JSON.stringify(settings).includes('sk-'), false)
})

test('embedding settings reject unsupported providers, Gemini models, dangling references, and duplicate bindings', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const base = {
    profiles: [localProfile],
    activeProfileId: 'local-dev',
    embeddingProfiles: [{
      id: 'gemini-main',
      name: 'Gemini main',
      provider: 'gemini',
      model: 'gemini-embedding-001',
      credentialRef: 'DSH_EMBEDDING_GEMINI_MAIN_API_KEY',
    }],
    retrievalBindings: [],
  }

  assert.throws(() => validateProfileSettings({
    ...base,
    embeddingProfiles: [{ ...base.embeddingProfiles[0], provider: 'custom' }],
  }), /provider is unsupported/i)

  assert.throws(() => validateProfileSettings({
    ...base,
    embeddingProfiles: [{ ...base.embeddingProfiles[0], model: 'gemini-pro' }],
  }), /Gemini model is unsupported/i)

  assert.throws(() => validateProfileSettings({
    ...base,
    retrievalBindings: [{
      milvusProfileId: 'local-dev',
      collection: 'documents',
      vectorField: 'embedding',
      embeddingProfileId: 'missing',
    }],
  }), /does not exist/i)

  const binding = {
    milvusProfileId: 'local-dev',
    collection: 'documents',
    vectorField: 'embedding',
    embeddingProfileId: 'gemini-main',
  }
  assert.throws(() => validateProfileSettings({
    ...base,
    retrievalBindings: [binding, { ...binding }],
  }), /must be unique/i)
})

test('collection retrieval policies validate exact BM25 routes and RRF or named Weighted defaults', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const base = { profiles: [localProfile], activeProfileId: 'local-dev' }
  const policy = {
    milvusProfileId: 'local-dev',
    collection: 'documents',
    textField: 'text',
    sparseField: 'sparse',
    schemaFingerprint: `sha256:${'a'.repeat(64)}`,
    rerank: { strategy: 'weighted', denseWeight: 0.7, bm25Weight: 0.3 },
  }
  assert.doesNotThrow(() => validateProfileSettings({ ...base, retrievalPolicies: [policy] }))
  assert.doesNotThrow(() => validateProfileSettings({
    ...base, retrievalPolicies: [{ ...policy, rerank: { strategy: 'rrf', k: 60 } }],
  }))
  assert.throws(() => validateProfileSettings({
    ...base, retrievalPolicies: [{ ...policy, rerank: { strategy: 'weighted', denseWeight: 0.7 } }],
  }), /weights/i)
  assert.throws(() => validateProfileSettings({
    ...base, retrievalPolicies: [policy, { ...policy }],
  }), /must be unique/i)
})
