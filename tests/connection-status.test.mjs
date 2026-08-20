import assert from 'node:assert/strict'
import test from 'node:test'

test('connection status starts idle before a browser requests a check', async () => {
  const { ConnectionStatusConfig } = await import('../connection-status.mjs')

  assert.deepEqual(ConnectionStatusConfig({}), { checks: {} })
})

test('a browser check request is resolved on the Host and publishes only its safe outcome', async () => {
  const { attachConnectionStatusMonitor } = await import('../connection-status.mjs')
  let watcher
  let status = {
    request: { profileId: 'cloud-rag', requestId: 1 },
    checks: {},
  }
  const statusScope = {
    watch(callback) {
      watcher = callback
      return () => {}
    },
    get() {
      return status
    },
    async update(patch) {
      status = { ...status, ...patch }
    },
  }
  const secret = 'never-browser-visible'

  attachConnectionStatusMonitor({
    statusScope,
    profileSource: () => ({ profiles: [{ id: 'cloud-rag', credentialRef: 'DSH_MILVUS_CLOUD_RAG_TOKEN' }] }),
    resolveCredential: async () => ({ value: secret, source: 'file' }),
    checkProfile: async (profile, { resolveCredential }) => {
      assert.equal((await resolveCredential(profile.credentialRef)).value, secret)
      return {
        profileId: profile.id,
        checkedAt: 1234,
        state: 'ready',
        message: 'Connected to Milvus.',
      }
    },
  })

  await watcher(status)

  assert.deepEqual(status.checks, {
    'cloud-rag': {
      profileId: 'cloud-rag',
      checkedAt: 1234,
      state: 'ready',
      message: 'Connected to Milvus.',
    },
  })
  assert.equal(JSON.stringify(status).includes(secret), false)
})

test('a later browser request prevents an older probe from replacing its status', async () => {
  const { attachConnectionStatusMonitor } = await import('../connection-status.mjs')
  let watcher
  const original = { request: { profileId: 'local-dev', requestId: 1 }, checks: {} }
  let status = original
  let release
  const pending = new Promise((resolve) => { release = resolve })
  const statusScope = {
    watch(callback) { watcher = callback; return () => {} },
    get() { return status },
    async update() { throw new Error('stale probe must not write') },
  }

  attachConnectionStatusMonitor({
    statusScope,
    profileSource: () => ({ profiles: [{ id: 'local-dev' }] }),
    resolveCredential: async () => undefined,
    checkProfile: async () => {
      await pending
      return { profileId: 'local-dev', checkedAt: 1, state: 'ready', message: 'Connected to Milvus.' }
    },
  })

  const running = watcher(original)
  status = { request: { profileId: 'local-dev', requestId: 2 }, checks: {} }
  release()
  await running
})
