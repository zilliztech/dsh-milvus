import { checkMilvusProfile } from './connection-check.mjs'
import { checkEmbeddingProfile } from './embedding-check.mjs'
import { collectionCapabilities } from './retrieval-capabilities.mjs'

export const MILVUS_STATUS_ROUTE = '/api/dsh-milvus.status'

const missingProfile = (profileId, checkedAt) => ({
  profileId,
  checkedAt,
  state: 'blocked',
  message: 'This profile is no longer configured.',
})

function requestRecord(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new TypeError('Milvus status request must be an object.')
  }
  return payload
}

function profileIdFrom(payload) {
  const profileId = requestRecord(payload).profileId
  if (typeof profileId !== 'string' || !profileId) {
    throw new TypeError('Milvus status request requires a profileId.')
  }
  return profileId
}

/** Check one configured Milvus deployment without exposing its credential. */
export async function checkConnectionStatus({
  payload,
  profileSource,
  resolveCredential,
  checkProfile = checkMilvusProfile,
  now = Date.now,
}) {
  const profileId = profileIdFrom(payload)
  const profile = profileSource().profiles?.find((item) => item.id === profileId)
  return profile
    ? await checkProfile(profile, { resolveCredential, now })
    : missingProfile(profileId, now())
}

/** Check one configured embedding provider without exposing its credential. */
export async function checkEmbeddingStatus({
  payload,
  profileSource,
  resolveCredential,
  checkProfile = checkEmbeddingProfile,
  now = Date.now,
}) {
  const profileId = profileIdFrom(payload)
  const profile = profileSource().embeddingProfiles?.find((item) => item.id === profileId)
  return profile
    ? await checkProfile(profile, { resolveCredential, now })
    : missingProfile(profileId, now())
}

function safeCollection(collection, settings, profile) {
  return {
    name: collection.name,
    fields: collection.fields.map((field) => ({
      name: field.name,
      dataType: field.dataType,
      kind: field.kind,
      ...(field.primaryKey === undefined ? {} : { primaryKey: field.primaryKey }),
      ...(field.dimension === undefined ? {} : { dimension: field.dimension }),
      ...(field.analyzerEnabled === undefined ? {} : { analyzerEnabled: field.analyzerEnabled }),
      ...(field.functionOutput === undefined ? {} : { functionOutput: field.functionOutput }),
    })),
    retrievalSchema: {
      schemaFingerprint: collection.retrievalSchema?.schemaFingerprint ?? 'unavailable',
      bm25Routes: collection.retrievalSchema?.bm25Routes ?? [],
      unsupportedSparseFields: collection.retrievalSchema?.unsupportedSparseFields ?? [],
    },
    capabilities: collectionCapabilities(collection, settings, profile),
  }
}

/** List and optionally inspect one collection on the Host. */
export async function checkCollectionStatus({
  payload,
  profileSource,
  createTransport,
  now = Date.now,
}) {
  const request = requestRecord(payload)
  const profileId = profileIdFrom(request)
  if (request.collection !== undefined && (typeof request.collection !== 'string' || !request.collection)) {
    throw new TypeError('Milvus collection request collection must be a non-empty string.')
  }

  const settings = profileSource()
  const profile = settings.profiles?.find((item) => item.id === profileId)
  if (!profile) {
    return {
      ...missingProfile(profileId, now()),
      collections: [],
      ...(request.collection ? { requestedCollection: request.collection } : {}),
    }
  }

  const transport = createTransport(profile)
  const listed = await transport.listCollections()
  if (listed.kind === 'blocked') {
    return {
      profileId: profile.id,
      checkedAt: now(),
      state: 'blocked',
      message: listed.message,
      collections: [],
      ...(request.collection ? { requestedCollection: request.collection } : {}),
    }
  }

  const collections = [...listed.collections].sort((left, right) => left.localeCompare(right))
  if (!request.collection) {
    return {
      profileId: profile.id,
      checkedAt: now(),
      state: 'ready',
      message: collections.length
        ? `Found ${collections.length} collection${collections.length === 1 ? '' : 's'}.`
        : 'Connected, but this database has no collections.',
      collections,
    }
  }

  const inspected = await transport.preflightCollection(request.collection)
  return inspected.kind === 'blocked'
    ? {
        profileId: profile.id,
        checkedAt: now(),
        state: 'blocked',
        message: inspected.message,
        collections,
        requestedCollection: request.collection,
      }
    : {
        profileId: profile.id,
        checkedAt: now(),
        state: 'ready',
        message: `Inspected ${inspected.collection.name}.`,
        collections,
        requestedCollection: request.collection,
        collection: safeCollection(inspected.collection, settings, profile),
      }
}

function failure(code, message, method) {
  return { ok: false, error: { code, message, details: { method } } }
}

/** Create the authenticated dsh Connection RPC handler used by the settings card. */
export function createMilvusStatusRpcHandler({
  profileSource,
  resolveCredential,
  createTransport,
  now = Date.now,
}) {
  return async (method, payload, signal) => {
    if (!['connection-check', 'embedding-check', 'collection-check'].includes(method)) {
      return failure('dsh-milvus/not-found', `Unknown Milvus status method: ${method}`, method)
    }

    try {
      signal?.throwIfAborted()
      const shared = { payload, profileSource, resolveCredential, createTransport, now }
      const value = method === 'connection-check'
        ? await checkConnectionStatus(shared)
        : method === 'embedding-check'
          ? await checkEmbeddingStatus(shared)
          : await checkCollectionStatus(shared)
      signal?.throwIfAborted()
      return { ok: true, value }
    } catch (error) {
      if (error instanceof TypeError) {
        return failure('dsh-milvus/bad-request', error.message, method)
      }
      return failure('dsh-milvus/request-failed', 'Milvus status request failed.', method)
    }
  }
}

/** Adapt the safe status dispatcher to an authenticated exact Fetch route. */
export function createMilvusStatusFetchHandler(options) {
  const dispatch = createMilvusStatusRpcHandler(options)
  return async (request) => {
    if (request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
      return Response.json(failure('dsh-milvus/bad-request', 'Milvus status requests must use JSON.', 'unknown'), {
        status: 415,
        headers: { 'cache-control': 'no-store' },
      })
    }

    let body
    try {
      body = await request.json()
    } catch {
      return Response.json(failure('dsh-milvus/bad-request', 'Milvus status request body must be JSON.', 'unknown'), {
        status: 400,
        headers: { 'cache-control': 'no-store' },
      })
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.method !== 'string') {
      return Response.json(failure('dsh-milvus/bad-request', 'Milvus status request requires a method.', 'unknown'), {
        status: 400,
        headers: { 'cache-control': 'no-store' },
      })
    }

    return Response.json(await dispatch(body.method, body.payload, request.signal), {
      headers: { 'cache-control': 'no-store' },
    })
  }
}
