import assert from 'node:assert/strict'
import test from 'node:test'
import { checkMilvusProfile } from '../connection-check.mjs'

const endpoint = process.env.MILVUS_TEST_ENDPOINT
const database = process.env.MILVUS_TEST_DATABASE ?? 'default'

test('the Host-only connection check reaches a real Local Milvus deployment', {
  skip: endpoint ? false : 'Set MILVUS_TEST_ENDPOINT to run against a real Milvus deployment.',
}, async () => {
  const result = await checkMilvusProfile({
    id: 'integration-local',
    kind: 'local',
    endpoint,
    database,
  }, {
    resolveCredential: async () => {
      throw new Error('Local profile without a credential must not resolve one.')
    },
  })

  assert.equal(result.profileId, 'integration-local')
  assert.equal(result.state, 'ready', result.message)
  assert.equal(result.message, 'Connected to Milvus.')
})
