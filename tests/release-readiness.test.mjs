import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('the published package contains a newcomer installation and safe Cloud smoke path', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8')
  const license = await readFile(new URL('../LICENSE', import.meta.url), 'utf8')

  assert.match(readme, /dsh plugin --profile web add @zilliz\/dsh-milvus/i)
  assert.match(readme, /dsh plugin --profile web update @zilliz\/dsh-milvus/i)
  assert.match(readme, /milvus_list_collections/)
  assert.match(readme, /milvus_describe_collection/)
  assert.match(readme, /milvus_query/)
  assert.match(readme, /milvus_get/)
  assert.match(readme, /milvus_search/)
  assert.match(readme, /milvus_text_search/)
  assert.match(readme, /milvus_hybrid_search/)
  assert.match(readme, /RRF.*k=60/i)
  assert.match(readme, /denseWeight/)
  assert.match(readme, /bm25Weight/)
  assert.match(readme, /Advanced settings/i)
  assert.match(readme, /Collection selector is populated/i)
  assert.match(readme, /Enable semantic search/i)
  for (const provider of ['OpenAI', 'Google Gemini', 'Cohere', 'Voyage AI', 'Mistral AI', 'Jina AI', 'Together AI']) {
    assert.match(readme, new RegExp(provider))
  }
  const { EMBEDDING_PROVIDER_CATALOG } = await import('../embedding-models.mjs')
  for (const definition of Object.values(EMBEDDING_PROVIDER_CATALOG)) {
    for (const model of Object.keys(definition.models)) assert.match(readme, new RegExp(model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
  assert.match(readme, /EMBEDDING_TEST_ALLOW_NETWORK=1/)
  assert.match(readme, /retrieval_binding_absent/)
  assert.match(readme, /generated query vectors are never returned/i)
  assert.match(readme, /Zilliz Cloud/)
  assert.match(readme, /values are never stored in plugin settings/i)
  assert.doesNotMatch(readme, /intentionally unpublished|future identity|authorization before changing/i)
  assert.match(license, /Apache License/i)
})
