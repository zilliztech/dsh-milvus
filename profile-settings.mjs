import z from '@deepseek-ai/schemastery'

export const PROFILE_KINDS = ['local', 'zilliz-cloud']
export const EMBEDDING_PROVIDERS = ['openai', 'gemini']
export const GEMINI_EMBEDDING_MODELS = ['gemini-embedding-001', 'gemini-embedding-2']

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

export const EmbeddingProfileConfig = z.object({
  id: z.string().required().description('Stable embedding profile identifier.'),
  name: z.string().required().description('Human-readable embedding profile name.'),
  provider: z.union([
    z.const('openai'),
    z.const('gemini'),
  ]).required().description('Embedding API provider.'),
  model: z.string().required().description('Embedding model identifier.'),
  credentialRef: z.string().required().description('Write-only dsh credential reference.'),
})

export const RetrievalBindingConfig = z.object({
  milvusProfileId: z.string().required().description('Milvus deployment profile identifier.'),
  collection: z.string().required().description('Milvus collection name.'),
  vectorField: z.string().required().description('Dense vector field name.'),
  embeddingProfileId: z.string().required().description('Embedding profile identifier.'),
})

export const RetrievalPolicyConfig = z.object({
  milvusProfileId: z.string().required().description('Milvus deployment profile identifier.'),
  collection: z.string().required().description('Milvus collection name.'),
  textField: z.string().required().description('BM25 Function input text field.'),
  sparseField: z.string().required().description('BM25 Function output sparse vector field.'),
  schemaFingerprint: z.string().description('Optional schema fingerprint captured when the route was inspected.'),
  rerank: z.object({
    strategy: z.union([z.const('rrf'), z.const('weighted')]).required(),
    k: z.number(),
    denseWeight: z.number(),
    bm25Weight: z.number(),
  }).description('Optional default hybrid rerank configuration.'),
})

export const ProfileSettingsConfig = z.object({
  profiles: z.array(ProfileConfig).default([]).description('Configured Milvus deployment profiles.'),
  activeProfileId: z.string().default('').description('Profile selected for new dsh sessions.'),
  embeddingProfiles: z.array(EmbeddingProfileConfig).default([]).description('DSH-managed embedding provider profiles.'),
  retrievalBindings: z.array(RetrievalBindingConfig).default([]).description('Collection vector fields bound to embedding profiles.'),
  retrievalPolicies: z.array(RetrievalPolicyConfig).default([]).description('Optional collection BM25 route and hybrid rerank defaults.'),
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

  const {
    profiles,
    activeProfileId,
    embeddingProfiles = [],
    retrievalBindings = [],
    retrievalPolicies = [],
  } = settings
  if (!Array.isArray(profiles)) fail('profiles must be an array')
  if (typeof activeProfileId !== 'string') fail('activeProfileId must be a string')
  if (!Array.isArray(embeddingProfiles)) fail('embeddingProfiles must be an array')
  if (!Array.isArray(retrievalBindings)) fail('retrievalBindings must be an array')
  if (!Array.isArray(retrievalPolicies)) fail('retrievalPolicies must be an array')
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

  const embeddingIds = new Set()
  const embeddingNames = new Set()
  for (const profile of embeddingProfiles) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      fail('every embedding profile must be an object')
    }

    const { id, name, provider, model, credentialRef } = profile
    if (typeof id !== 'string' || !profileIdPattern.test(id)) {
      fail('embedding profile id must be lowercase kebab-case')
    }
    if (embeddingIds.has(id)) fail(`embedding profile id "${id}" must be unique`)
    embeddingIds.add(id)

    if (typeof name !== 'string' || !name.trim()) {
      fail(`embedding profile "${id}" name is required`)
    }
    const normalizedName = name.trim().toLocaleLowerCase()
    if (embeddingNames.has(normalizedName)) {
      fail(`embedding profile name "${name}" must be unique`)
    }
    embeddingNames.add(normalizedName)

    if (!EMBEDDING_PROVIDERS.includes(provider)) {
      fail(`embedding profile "${id}" provider is unsupported`)
    }
    if (typeof model !== 'string' || !model.trim()) {
      fail(`embedding profile "${id}" model is required`)
    }
    if (provider === 'gemini' && !GEMINI_EMBEDDING_MODELS.includes(model)) {
      fail(`embedding profile "${id}" Gemini model is unsupported`)
    }
    if (typeof credentialRef !== 'string' || !credentialRefPattern.test(credentialRef)) {
      fail(`embedding profile "${id}" credentialRef must be a POSIX environment-style identifier`)
    }
  }

  const bindingKeys = new Set()
  for (const binding of retrievalBindings) {
    if (!binding || typeof binding !== 'object' || Array.isArray(binding)) {
      fail('every retrieval binding must be an object')
    }

    const { milvusProfileId, collection, vectorField, embeddingProfileId } = binding
    if (typeof milvusProfileId !== 'string' || !ids.has(milvusProfileId)) {
      fail(`retrieval binding Milvus profile "${milvusProfileId}" does not exist`)
    }
    if (typeof collection !== 'string' || !collection.trim()) {
      fail('retrieval binding collection is required')
    }
    if (typeof vectorField !== 'string' || !vectorField.trim()) {
      fail('retrieval binding vectorField is required')
    }
    if (typeof embeddingProfileId !== 'string' || !embeddingIds.has(embeddingProfileId)) {
      fail(`retrieval binding embedding profile "${embeddingProfileId}" does not exist`)
    }

    const bindingKey = `${milvusProfileId}\u0000${collection}\u0000${vectorField}`
    if (bindingKeys.has(bindingKey)) {
      fail(`retrieval binding for "${collection}.${vectorField}" must be unique per Milvus profile`)
    }
    bindingKeys.add(bindingKey)
  }

  const policyKeys = new Set()
  for (const policy of retrievalPolicies) {
    if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
      fail('every retrieval policy must be an object')
    }
    const { milvusProfileId, collection, textField, sparseField, schemaFingerprint, rerank } = policy
    if (typeof milvusProfileId !== 'string' || !ids.has(milvusProfileId)) {
      fail(`retrieval policy Milvus profile "${milvusProfileId}" does not exist`)
    }
    for (const [field, value] of Object.entries({ collection, textField, sparseField })) {
      if (typeof value !== 'string' || !value.trim()) fail(`retrieval policy ${field} is required`)
    }
    if (schemaFingerprint !== undefined && (typeof schemaFingerprint !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(schemaFingerprint))) {
      fail('retrieval policy schemaFingerprint must be a SHA-256 schema fingerprint when configured')
    }
    if (rerank !== undefined) {
      if (!rerank || typeof rerank !== 'object' || Array.isArray(rerank)) fail('retrieval policy rerank must be an object')
      if (rerank.strategy === 'rrf') {
        const k = rerank.k === undefined ? 60 : rerank.k
        if (typeof k !== 'number' || !Number.isFinite(k) || k <= 0 || k >= 16_384) {
          fail('retrieval policy RRF k must be greater than 0 and less than 16,384')
        }
        if (rerank.denseWeight !== undefined || rerank.bm25Weight !== undefined) {
          fail('retrieval policy RRF must not include weights')
        }
      } else if (rerank.strategy === 'weighted') {
        if (rerank.k !== undefined) fail('retrieval policy Weighted rerank must not include k')
        const weights = [rerank.denseWeight, rerank.bm25Weight]
        if (!weights.every((weight) => typeof weight === 'number' && Number.isFinite(weight) && weight >= 0 && weight <= 1)
          || weights.every((weight) => weight === 0)) {
          fail('retrieval policy weights must be between 0 and 1 and cannot both be zero')
        }
      } else {
        fail('retrieval policy rerank strategy must be rrf or weighted')
      }
    }
    const policyKey = `${milvusProfileId}\u0000${collection}`
    if (policyKeys.has(policyKey)) fail(`retrieval policy for "${collection}" must be unique per Milvus profile`)
    policyKeys.add(policyKey)
  }
}
