const OPENAI_EMBEDDINGS_URL = 'https://api.openai.com/v1/embeddings'
const GEMINI_API_ROOT = 'https://generativelanguage.googleapis.com/v1beta/models'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_EMBEDDING_DIMENSION = 3_072

function blocked(reason, message) {
  return { kind: 'blocked', reason, message }
}

function providerFailure(status) {
  if (status === 401 || status === 403) {
    return blocked('embedding_auth_rejected', 'The embedding provider rejected the configured credential.')
  }
  if (status === 429) {
    return blocked('embedding_rate_limited', 'The embedding provider rate limit was reached. Try again later.')
  }
  if (status === 404) {
    return blocked('embedding_model_unavailable', 'The configured embedding model is unavailable.')
  }
  if (status >= 400 && status < 500) {
    return blocked('embedding_request_rejected', 'The embedding provider rejected this embedding request.')
  }
  return blocked('embedding_provider_unavailable', 'The embedding provider is temporarily unavailable.')
}

function validateRequest(profile, text, dimensions) {
  if (!profile) {
    return blocked('embedding_profile_absent', 'Configure an embedding profile before using dense search.')
  }
  if (typeof text !== 'string' || !text.trim() || text.length > 16_000) {
    return blocked('invalid_search', 'The dense-search query must contain 1 through 16,000 characters.')
  }
  if (!Number.isInteger(dimensions) || dimensions < 1 || dimensions > MAX_EMBEDDING_DIMENSION) {
    return blocked('unsupported_vector_dimension', 'The target vector field must have a supported dimension from 1 through 3,072.')
  }
}

function normalizeVector(vector) {
  const norm = Math.hypot(...vector)
  if (!Number.isFinite(norm) || norm === 0) return undefined
  return vector.map((value) => value / norm)
}

function validateVector(vector, dimensions) {
  if (!Array.isArray(vector) || vector.length !== dimensions) {
    return blocked('embedding_dimension_mismatch', 'The embedding result does not match the target Milvus vector dimension.')
  }
  if (vector.some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
    return blocked('embedding_response_invalid', 'The embedding provider returned an invalid vector.')
  }
}

function openAIRequest(profile, text, dimensions, credential) {
  const body = {
    input: text,
    model: profile.model,
    encoding_format: 'float',
  }
  if (/^text-embedding-3(?:-|$)/.test(profile.model)) body.dimensions = dimensions
  return {
    url: OPENAI_EMBEDDINGS_URL,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${credential}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    extract: (payload) => payload?.data?.[0]?.embedding,
    usage: (payload) => payload?.usage
      ? {
          ...(Number.isFinite(payload.usage.prompt_tokens) ? { promptTokens: payload.usage.prompt_tokens } : {}),
          ...(Number.isFinite(payload.usage.total_tokens) ? { totalTokens: payload.usage.total_tokens } : {}),
        }
      : undefined,
  }
}

function geminiRequest(profile, text, dimensions, credential) {
  const isLegacyModel = profile.model === 'gemini-embedding-001'
  const preparedText = isLegacyModel ? text : `task: search result | query: ${text}`
  const body = {
    content: { parts: [{ text: preparedText }] },
    ...(isLegacyModel ? { taskType: 'RETRIEVAL_QUERY' } : {}),
    outputDimensionality: dimensions,
  }
  return {
    url: `${GEMINI_API_ROOT}/${encodeURIComponent(profile.model)}:embedContent`,
    init: {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': credential,
      },
      body: JSON.stringify(body),
    },
    extract: (payload) => payload?.embedding?.values,
    normalize: isLegacyModel && dimensions < MAX_EMBEDDING_DIMENSION,
  }
}

/**
 * Create the host-only embedding boundary. Provider credentials and generated
 * vectors never cross into settings or browser state.
 */
export function createEmbeddingProvider({
  resolveCredential,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  return {
    async embedQuery({ profile, text, dimensions, signal } = {}) {
      const invalid = validateRequest(profile, text, dimensions)
      if (invalid) return invalid

      let resolved
      try {
        resolved = profile.credentialRef
          ? await resolveCredential(profile.credentialRef)
          : undefined
      } catch {
        return blocked('embedding_credential_unavailable', 'The embedding profile credential is unavailable.')
      }
      if (!resolved?.value) {
        return blocked('embedding_credential_unavailable', 'The embedding profile credential is unavailable.')
      }

      const request = profile.provider === 'openai'
        ? openAIRequest(profile, text, dimensions, resolved.value)
        : profile.provider === 'gemini'
          ? geminiRequest(profile, text, dimensions, resolved.value)
          : undefined
      if (!request) {
        return blocked('embedding_provider_unsupported', 'The configured embedding provider is unsupported.')
      }

      const startedAt = now()
      const timeoutSignal = AbortSignal.timeout(timeoutMs)
      const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal
      let response
      try {
        response = await fetchImpl(request.url, { ...request.init, signal: requestSignal })
      } catch {
        if (signal?.aborted) return blocked('embedding_cancelled', 'The embedding request was cancelled.')
        if (timeoutSignal.aborted) return blocked('embedding_timeout', 'The embedding provider did not respond before the timeout.')
        return blocked('embedding_provider_unavailable', 'The embedding provider could not be reached.')
      }
      if (!response?.ok) return providerFailure(response?.status)

      let payload
      try {
        payload = await response.json()
      } catch {
        return blocked('embedding_response_invalid', 'The embedding provider returned an invalid response.')
      }

      let vector = request.extract(payload)
      const vectorError = validateVector(vector, dimensions)
      if (vectorError) return vectorError
      if (request.normalize) {
        vector = normalizeVector(vector)
        if (!vector) return blocked('embedding_response_invalid', 'The embedding provider returned an invalid vector.')
      }

      const usage = request.usage?.(payload)

      return {
        kind: 'ready',
        vector,
        provenance: {
          provider: profile.provider,
          model: profile.model,
          dimension: dimensions,
          latencyMs: Math.max(0, now() - startedAt),
          ...(usage ? { usage } : {}),
          ...(response.headers?.get?.('x-request-id') ? { requestId: response.headers.get('x-request-id') } : {}),
        },
      }
    },
  }
}
