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
  assert.match(readme, /Zilliz Cloud/)
  assert.match(readme, /never.*token|token.*never/i)
  assert.doesNotMatch(readme, /intentionally unpublished|future identity|authorization before changing/i)
  assert.match(license, /Apache License/i)
})
