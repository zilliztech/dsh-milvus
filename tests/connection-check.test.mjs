import assert from 'node:assert/strict'
import test from 'node:test'

test('a host connection check resolves a Cloud credential once and returns only safe status', async () => {
  const { checkMilvusProfile } = await import('../connection-check.mjs')
  const profile = {
    id: 'cloud-rag',
    name: 'Cloud RAG',
    kind: 'zilliz-cloud',
    endpoint: 'https://in01-example.cloud.zilliz.com',
    database: 'rag',
    credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN',
  }
  let clientOptions
  let resolvedRef

  const result = await checkMilvusProfile(profile, {
    resolveCredential: async (ref) => {
      resolvedRef = ref
      return { value: 'super-secret-token', source: 'file' }
    },
    createClient: (options) => {
      clientOptions = options
      return { listCollections: async () => ({ code: 0, data: [] }) }
    },
    now: () => 1234,
  })

  assert.equal(resolvedRef, 'DSH_MILVUS_CLOUD_RAG_TOKEN')
  assert.deepEqual(clientOptions, {
    endpoint: profile.endpoint,
    database: profile.database,
    token: 'super-secret-token',
    timeout: 10_000,
  })
  assert.deepEqual(result, {
    profileId: 'cloud-rag',
    checkedAt: 1234,
    state: 'ready',
    message: 'Connected to Milvus.',
  })
  assert.equal(JSON.stringify(result).includes('super-secret-token'), false)
})

test('a missing Cloud credential blocks the check before any network client is created', async () => {
  const { checkMilvusProfile } = await import('../connection-check.mjs')
  let created = false

  const result = await checkMilvusProfile({
    id: 'cloud-rag',
    kind: 'zilliz-cloud',
    endpoint: 'https://in01-example.cloud.zilliz.com',
    database: 'rag',
    credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN',
  }, {
    resolveCredential: async () => undefined,
    createClient: () => { created = true },
    now: () => 1234,
  })

  assert.equal(created, false)
  assert.deepEqual(result, {
    profileId: 'cloud-rag',
    checkedAt: 1234,
    state: 'blocked',
    message: 'The configured credential is unavailable.',
  })
})

test('a database-free Cloud check uses an empty SDK database instead of the SDK default', async () => {
  const { checkMilvusProfile } = await import('../connection-check.mjs')
  let clientOptions

  const result = await checkMilvusProfile({
    id: 'cloud-serverless',
    kind: 'zilliz-cloud',
    endpoint: 'https://in01-example.serverless.cloud.zilliz.com',
    credentialRef: 'DSH_MILVUS_CLOUD_TOKEN',
  }, {
    resolveCredential: async () => ({ value: 'runtime-token' }),
    createClient: (options) => {
      clientOptions = options
      return { listCollections: async () => ({ code: 0, data: [] }) }
    },
    now: () => 1234,
  })

  assert.equal(clientOptions.database, '')
  assert.equal(result.state, 'ready')
})

test('a connection failure never reflects credential text into browser-visible status', async () => {
  const { checkMilvusProfile } = await import('../connection-check.mjs')
  const token = 'do-not-disclose-this-token'

  const result = await checkMilvusProfile({
    id: 'local-dev',
    kind: 'local',
    endpoint: 'http://127.0.0.1:19530',
    database: 'default',
    credentialRef: 'DSH_MILVUS_LOCAL_TOKEN',
  }, {
    resolveCredential: async () => ({ value: token, source: 'file' }),
    createClient: () => ({ listCollections: async () => { throw new Error(`server rejected ${token}`) } }),
    now: () => 1234,
  })

  assert.deepEqual(result, {
    profileId: 'local-dev',
    checkedAt: 1234,
    state: 'failed',
    message: 'Could not connect to or authenticate with this Milvus profile.',
  })
  assert.equal(JSON.stringify(result).includes(token), false)
})
