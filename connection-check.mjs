import { HttpClient } from '@zilliz/milvus2-sdk-node'
import { sdkDatabase } from './sdk-database.mjs'

const READY = 'Connected to Milvus.'
const UNAVAILABLE_CREDENTIAL = 'The configured credential is unavailable.'
const CONNECTION_FAILURE = 'Could not connect to or authenticate with this Milvus profile.'

/**
 * Perform the smallest real host-side connectivity probe.
 *
 * The resolved credential is scoped to the HttpClient construction and never
 * appears in the return value, thrown message, or settings data.
 */
export async function checkMilvusProfile(profile, {
  resolveCredential,
  createClient = (options) => new HttpClient(options),
  now = Date.now,
} = {}) {
  const checkedAt = now()
  let token

  if (profile.credentialRef) {
    const resolved = await resolveCredential(profile.credentialRef)
    token = resolved?.value
  }
  if (profile.kind === 'zilliz-cloud' && !token) {
    return {
      profileId: profile.id,
      checkedAt,
      state: 'blocked',
      message: UNAVAILABLE_CREDENTIAL,
    }
  }

  try {
    const database = sdkDatabase(profile)
    const client = createClient({
      endpoint: profile.endpoint,
      ...(database === undefined ? {} : { database }),
      ...(token ? { token } : {}),
      timeout: 10_000,
    })
    const response = await client.listCollections(profile.database ? { dbName: profile.database } : {})
    if (response.code !== 0) throw new Error('Milvus rejected the connection probe.')
    return {
      profileId: profile.id,
      checkedAt,
      state: 'ready',
      message: READY,
    }
  } catch {
    return {
      profileId: profile.id,
      checkedAt,
      state: 'failed',
      message: CONNECTION_FAILURE,
    }
  }
}
