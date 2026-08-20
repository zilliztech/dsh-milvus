import assert from 'node:assert/strict'
import test from 'node:test'
import { HttpClient } from '@zilliz/milvus2-sdk-node'

const endpoint = process.env.MILVUS_TEST_ENDPOINT
const database = process.env.MILVUS_TEST_DATABASE ?? 'default'
const token = process.env.MILVUS_TEST_TOKEN

const scalarField = (field) => !/vector/i.test(field.type ?? '')

test('the official HTTP SDK can make bounded read-only requests to Milvus', {
  skip: endpoint ? false : 'Set MILVUS_TEST_ENDPOINT to run against a real Milvus deployment.',
}, async (t) => {
  const client = new HttpClient({
    endpoint,
    database,
    ...(token ? { token } : {}),
    timeout: 10_000,
  })

  const collections = await client.listCollections({ dbName: database })
  assert.equal(collections.code, 0, collections.message)
  assert.ok(Array.isArray(collections.data))

  // An empty deployment proves the transport path only. We cannot safely
  // invent a collection name or business filter merely to exercise query.
  if (collections.data.length === 0) {
    t.diagnostic('Deployment is empty; transport and collection discovery passed, while schema and query were intentionally not attempted.')
    return
  }

  const collectionName = collections.data[0]
  const description = await client.describeCollection({ collectionName, dbName: database })
  assert.equal(description.code, 0, description.message)
  assert.equal(description.data.collectionName, collectionName)

  const statistics = await client.getCollectionStatistics({ collectionName, dbName: database })
  assert.equal(statistics.code, 0, statistics.message)

  const fields = description.data.fields.filter(scalarField)
  // A collection with only vector fields cannot satisfy the v0.1 contract,
  // which intentionally never returns embeddings.
  if (fields.length === 0) return

  const query = await client.query({
    collectionName,
    dbName: database,
    outputFields: [fields[0].name ?? fields[0].fieldName],
    limit: 1,
  })
  assert.equal(query.code, 0, query.message)
  assert.ok(Array.isArray(query.data))
})
