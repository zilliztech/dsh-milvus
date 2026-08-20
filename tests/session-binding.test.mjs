import assert from 'node:assert/strict'
import test from 'node:test'

const profile = {
  id: 'local-dev',
  name: 'Local development',
  kind: 'local',
  endpoint: 'http://127.0.0.1:19530',
  database: 'default',
}

test('a new live session binds the selected profile once despite dsh bootstrap events', async () => {
  const { bindOrResolveSessionProfile } = await import('../session-binding.mjs')
  const session = {
    events: [
      { type: 'permission/preset' },
      { type: 'sandbox/mode' },
      { type: 'approval/policy' },
      { type: 'agent/inbox/spliced' },
    ],
  }

  const initial = bindOrResolveSessionProfile(session, {
    activeProfileId: 'local-dev',
    profiles: [profile],
  })
  const afterEndpointEdit = bindOrResolveSessionProfile(session, {
    activeProfileId: 'local-dev',
    profiles: [{ ...profile, endpoint: 'http://127.0.0.1:19531' }],
  })

  assert.deepEqual(initial, profile)
  assert.equal(afterEndpointEdit, undefined)
  assert.deepEqual(session.events, [
    { type: 'permission/preset' },
    { type: 'sandbox/mode' },
    { type: 'approval/policy' },
    { type: 'agent/inbox/spliced' },
  ])
})

test('a reloaded session without a live binding fails closed instead of adopting the active profile', async () => {
  const { bindOrResolveSessionProfile } = await import('../session-binding.mjs')
  const session = { events: [{ type: 'user/message' }] }

  assert.equal(bindOrResolveSessionProfile(session, {
    activeProfileId: 'local-dev',
    profiles: [profile],
  }), undefined)
})
