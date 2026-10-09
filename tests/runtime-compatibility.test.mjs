import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const packageUrl = new URL('../package.json', import.meta.url)

test('the public Desktop and Web onboarding path requires the dsh 0.2 runtime contracts', async () => {
  const manifest = JSON.parse(await readFile(packageUrl, 'utf8'))

  for (const name of [
    '@deepseek-ai/dsh-client-connection',
    '@deepseek-ai/dsh-settings',
    '@deepseek-ai/dsh-credentials',
    '@deepseek-ai/dsh-tools',
  ]) assert.equal(manifest.peerDependencies[name], '0.2.0-rc.2')
  assert.equal(manifest.peerDependencies['@deepseek-ai/cordis'], '~4.0.4')
  assert.equal(manifest.peerDependencies['@deepseek-ai/schemastery'], '~3.18.4')
})
