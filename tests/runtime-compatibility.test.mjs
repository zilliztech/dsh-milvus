import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageUrl = new URL('../package.json', import.meta.url)

test('the public Web onboarding path requires dsh rc.7 settings exposure', async () => {
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))

  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-settings'], '^0.1.0-rc.7')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-credentials'], '^0.1.0-rc.7')
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-tools'], '^0.1.0-rc.7')
})
