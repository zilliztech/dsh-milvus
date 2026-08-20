import assert from 'node:assert/strict'
import test from 'node:test'

const localProfile = {
  id: 'local-dev',
  name: 'Local development',
  kind: 'local',
  endpoint: 'http://127.0.0.1:19530',
  database: 'default',
}

test('a selected Local profile has a fixed endpoint and database without a secret', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const settings = {
    profiles: [localProfile],
    activeProfileId: 'local-dev',
  }

  assert.doesNotThrow(() => validateProfileSettings(settings))
  assert.equal(JSON.stringify(settings).includes('token'), false)
})

test('a Cloud profile may omit its database while referring to a credential without embedding its value in settings', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')
  const settings = {
    profiles: [{
      id: 'cloud-prod',
      name: 'Zilliz Cloud',
      kind: 'zilliz-cloud',
      endpoint: 'https://in01-example.cloud.zilliz.com',
      credentialRef: 'DSH_MILVUS_CLOUD_PROD_TOKEN',
    }],
    activeProfileId: 'cloud-prod',
  }

  assert.doesNotThrow(() => validateProfileSettings(settings))
  assert.equal(settings.profiles[0].credentialRef, 'DSH_MILVUS_CLOUD_PROD_TOKEN')
  assert.equal(Object.hasOwn(settings.profiles[0], 'token'), false)
})

test('profile settings reject unsafe or ambiguous configuration before persistence', async () => {
  const { validateProfileSettings } = await import('../profile-settings.mjs')

  assert.throws(() => validateProfileSettings({
    profiles: [{ ...localProfile, token: 'must-not-be-here' }],
    activeProfileId: 'local-dev',
  }), /secret/i)

  assert.throws(() => validateProfileSettings({
    profiles: [localProfile],
    activeProfileId: 'missing-profile',
  }), /active profile/i)

  assert.throws(() => validateProfileSettings({
    profiles: [{
      id: 'cloud-over-http',
      name: 'Cloud over HTTP',
      kind: 'zilliz-cloud',
      endpoint: 'http://cloud.example.com',
      database: 'default',
      credentialRef: 'DSH_MILVUS_CLOUD_TOKEN',
    }],
    activeProfileId: 'cloud-over-http',
  }), /https/i)
})
