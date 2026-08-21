import assert from 'node:assert/strict'
import test from 'node:test'
import { inspectRetrievalSchema, normalizeField, normalizeFunction, normalizeIndex } from '../retrieval-schema.mjs'

function validFacts() {
  const fields = [
    normalizeField({ name: 'text', type: 'VarChar', params: [{ key: 'enable_analyzer', value: 'true' }] }),
    normalizeField({ name: 'dense', type: 'FloatVector', params: [{ key: 'dim', value: '3' }] }),
    normalizeField({ name: 'sparse', type: 'SparseFloatVector', isFunctionOutput: true }),
  ]
  const indexes = [
    normalizeIndex({ fieldName: 'dense', indexName: 'dense_idx', metricType: 'COSINE' }),
    normalizeIndex({ fieldName: 'sparse', indexName: 'sparse_idx', metricType: 'BM25' }),
  ]
  const functions = [normalizeFunction({
    name: 'text_bm25', type: 1, inputFieldNames: ['text'], outputFieldNames: ['sparse'],
  })]
  return { fields, indexes, functions }
}

test('normalizes a Milvus BM25 Function into one schema-proven text route', () => {
  const { fields, indexes, functions } = validFacts()
  assert.equal(fields[0].analyzerEnabled, true)
  assert.equal(fields[1].dimension, 3)
  assert.equal(functions[0].type, 'BM25')

  const inspected = inspectRetrievalSchema(fields, indexes, functions)
  assert.match(inspected.schemaFingerprint, /^sha256:[a-f0-9]{64}$/)
  assert.deepEqual(inspected.bm25Routes, [{
    functionName: 'text_bm25',
    inputField: 'text',
    outputField: 'sparse',
    indexName: 'sparse_idx',
    metricType: 'BM25',
  }])
  assert.deepEqual(inspected.unsupportedSparseFields, [])
})

test('does not infer raw-text search from a sparse field without every BM25 schema guarantee', () => {
  const facts = validFacts()
  const analyzerDisabled = facts.fields.map((field) => field.name === 'text'
    ? { ...field, analyzerEnabled: false }
    : field)
  const inspected = inspectRetrievalSchema(analyzerDisabled, facts.indexes, facts.functions)
  assert.deepEqual(inspected.bm25Routes, [])
  assert.deepEqual(inspected.unsupportedSparseFields, ['sparse'])
})

test('schema fingerprints are stable across response ordering and change with retrieval facts', () => {
  const facts = validFacts()
  const first = inspectRetrievalSchema(facts.fields, facts.indexes, facts.functions)
  const reordered = inspectRetrievalSchema([...facts.fields].reverse(), [...facts.indexes].reverse(), facts.functions)
  assert.equal(first.schemaFingerprint, reordered.schemaFingerprint)

  const changed = inspectRetrievalSchema(
    facts.fields.map((field) => field.name === 'dense' ? { ...field, dimension: 4 } : field),
    facts.indexes,
    facts.functions,
  )
  assert.notEqual(first.schemaFingerprint, changed.schemaFingerprint)
})
