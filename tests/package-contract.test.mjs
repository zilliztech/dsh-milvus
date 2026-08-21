import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const packageUrl = new URL('../package.json', import.meta.url)
const packageLockUrl = new URL('../package-lock.json', import.meta.url)

test('the package exposes a loadable dsh host and web-client bundle', async () => {
  const [manifestSource, lockSource] = await Promise.all([
    readFile(packageUrl, 'utf8'),
    readFile(packageLockUrl, 'utf8'),
  ])
  const manifest = JSON.parse(manifestSource)
  const lock = JSON.parse(lockSource)

  assert.equal(manifest.type, 'module')
  assert.equal(lock.name, manifest.name)
  assert.equal(lock.version, manifest.version)
  assert.equal(lock.packages[''].name, manifest.name)
  assert.equal(lock.packages[''].version, manifest.version)
  assert.equal(manifest.dsh?.bundle?.patch, './cordis.patch.yml')
  assert.equal(manifest.dsh?.client?.platform, 'web')
  assert.deepEqual(manifest.dsh?.client?.inject, ['@deepseek-ai/dsh-client-ui-settings-plugins'])
  assert.equal(typeof manifest.exports?.['.'], 'string')
  assert.equal(typeof manifest.exports?.['./client'], 'string')
  assert.equal(typeof manifest.exports?.['./package.json'], 'string')

  await Promise.all([
    access(new URL(`../${manifest.exports['.']}`, import.meta.url)),
    access(new URL(`../${manifest.exports['./client']}`, import.meta.url)),
    access(new URL('../cordis.patch.yml', import.meta.url)),
  ])
})
