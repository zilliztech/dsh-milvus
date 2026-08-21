import { createEmbeddingProvider } from './embedding-provider.mjs'

const READY = 'Connected to the embedding provider.'
const UNAVAILABLE_CREDENTIAL = 'The configured embedding API key is unavailable.'
const CONNECTION_FAILURE = 'Could not authenticate with or call this embedding provider profile.'

/** Run one minimal host-side embedding request and return only safe status. */
export async function checkEmbeddingProfile(profile, {
  resolveCredential,
  providerFactory = createEmbeddingProvider,
  now = Date.now,
} = {}) {
  const checkedAt = now()
  const provider = providerFactory({ resolveCredential, now })
  const result = await provider.embedQuery({
    profile,
    text: 'DSH embedding connection check',
    dimensions: 128,
  })
  if (result.kind === 'ready') {
    return {
      profileId: profile.id,
      checkedAt,
      state: 'ready',
      message: READY,
    }
  }
  if (result.reason === 'embedding_credential_unavailable') {
    return {
      profileId: profile.id,
      checkedAt,
      state: 'blocked',
      message: UNAVAILABLE_CREDENTIAL,
    }
  }
  return {
    profileId: profile.id,
    checkedAt,
    state: 'failed',
    message: CONNECTION_FAILURE,
  }
}
