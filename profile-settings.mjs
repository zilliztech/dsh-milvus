import z from '@deepseek-ai/schemastery'

export const PROFILE_KINDS = ['local', 'zilliz-cloud']

const profileIdPattern = /^[a-z][a-z0-9-]{0,63}$/
const credentialRefPattern = /^[A-Za-z_][A-Za-z0-9_]*$/
const secretKeyPattern = /(token|password|secret)/i

export const ProfileConfig = z.object({
  id: z.string().required().description('Stable profile identifier.'),
  name: z.string().required().description('Human-readable deployment name.'),
  kind: z.union([
    z.const('local'),
    z.const('zilliz-cloud'),
  ]).required().description('Milvus deployment type.'),
  endpoint: z.string().required().description('Milvus HTTP(S) endpoint.'),
  database: z.string().description('Optional Milvus database name.'),
  credentialRef: z.string().description('Write-only dsh credential reference.'),
})

export const ProfileSettingsConfig = z.object({
  profiles: z.array(ProfileConfig).default([]).description('Configured Milvus deployment profiles.'),
  activeProfileId: z.string().default('').description('Profile selected for new dsh sessions.'),
})

function fail(message) {
  throw new TypeError(`Invalid Milvus profile settings: ${message}`)
}

function assertNoEmbeddedSecrets(value, path = 'settings') {
  if (!value || typeof value !== 'object') return

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`
    if (secretKeyPattern.test(key) && key !== 'credentialRef') {
      fail(`secret field "${childPath}" is not allowed; use credentialRef instead`)
    }
    assertNoEmbeddedSecrets(child, childPath)
  }
}

function parseEndpoint(endpoint, profileId) {
  let url
  try {
    url = new URL(endpoint)
  } catch {
    fail(`profile "${profileId}" endpoint must be an absolute HTTP(S) URL`)
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    fail(`profile "${profileId}" endpoint must use HTTP or HTTPS`)
  }
  if (!url.hostname) fail(`profile "${profileId}" endpoint must include a hostname`)
  if (url.username || url.password) {
    fail(`profile "${profileId}" endpoint must not embed credentials`)
  }
  if (url.pathname !== '/' || url.search || url.hash) {
    fail(`profile "${profileId}" endpoint must not include a path, query, or fragment`)
  }

  return url
}

/**
 * Validate the settings boundary shared by the host plugin and dsh persistence.
 * Settings contain target facts only; credential values remain in dsh Credentials.
 */
export function validateProfileSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    fail('settings must be an object')
  }

  assertNoEmbeddedSecrets(settings)

  const { profiles, activeProfileId } = settings
  if (!Array.isArray(profiles)) fail('profiles must be an array')
  if (typeof activeProfileId !== 'string') fail('activeProfileId must be a string')
  if (!profiles.length && activeProfileId) {
    fail('an active profile cannot be selected when no profiles exist')
  }

  const ids = new Set()
  const names = new Set()

  for (const profile of profiles) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      fail('every profile must be an object')
    }
    const { id, name, kind, endpoint, database, credentialRef } = profile

    if (typeof id !== 'string' || !profileIdPattern.test(id)) {
      fail('profile id must be lowercase kebab-case')
    }
    if (ids.has(id)) fail(`profile id "${id}" must be unique`)
    ids.add(id)

    if (typeof name !== 'string' || !name.trim()) fail(`profile "${id}" name is required`)
    const normalizedName = name.trim().toLocaleLowerCase()
    if (names.has(normalizedName)) fail(`profile name "${name}" must be unique`)
    names.add(normalizedName)

    if (!PROFILE_KINDS.includes(kind)) fail(`profile "${id}" kind is unsupported`)
    if (typeof endpoint !== 'string' || !endpoint.trim()) fail(`profile "${id}" endpoint is required`)
    const url = parseEndpoint(endpoint, id)
    if (kind === 'zilliz-cloud' && url.protocol !== 'https:') {
      fail(`Cloud profile "${id}" endpoint must use HTTPS`)
    }

    if (database !== undefined && (typeof database !== 'string' || !database.trim())) {
      fail(`profile "${id}" database must be a non-empty string when configured`)
    }
    if (credentialRef !== undefined && (typeof credentialRef !== 'string' || !credentialRefPattern.test(credentialRef))) {
      fail(`profile "${id}" credentialRef must be a POSIX environment-style identifier`)
    }
    if (kind === 'zilliz-cloud' && !credentialRef) {
      fail(`Cloud profile "${id}" requires a credentialRef`)
    }
  }

  if (activeProfileId && !ids.has(activeProfileId)) {
    fail(`active profile "${activeProfileId}" does not exist`)
  }
}
