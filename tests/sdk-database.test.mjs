import assert from 'node:assert/strict'
import test from 'node:test'
import { sdkDatabase } from '../sdk-database.mjs'

test('returns the profile database when configured', () => {
  assert.equal(sdkDatabase({ kind: 'local', database: 'default' }), 'default')
  assert.equal(sdkDatabase({ kind: 'zilliz-cloud', database: 'rag' }), 'rag')
})

test('uses an empty SDK database for a database-free Cloud profile', () => {
  assert.equal(sdkDatabase({ kind: 'zilliz-cloud', database: '' }), '')
  assert.equal(sdkDatabase({ kind: 'zilliz-cloud' }), '')
})

test('lets a database-free Local profile omit the SDK database entirely', () => {
  assert.equal(sdkDatabase({ kind: 'local', database: '' }), undefined)
  assert.equal(sdkDatabase({ kind: 'local' }), undefined)
})
