import z from '@deepseek-ai/schemastery'
import { checkMilvusProfile } from './connection-check.mjs'
import { checkEmbeddingProfile } from './embedding-check.mjs'
import { collectionCapabilities } from './retrieval-capabilities.mjs'

export const MILVUS_STATUS_NAMESPACE = 'dsh-milvus-status'

const CheckResultConfig = z.object({
  profileId: z.string().required(),
  checkedAt: z.number().required(),
  state: z.string().required(),
  message: z.string().required(),
})

const CollectionFieldConfig = z.object({
  name: z.string().required(),
  dataType: z.string().required(),
  kind: z.string().required(),
  primaryKey: z.boolean(),
  dimension: z.number(),
  analyzerEnabled: z.boolean(),
  functionOutput: z.boolean(),
})

const Bm25RouteConfig = z.object({
  functionName: z.string().required(),
  inputField: z.string().required(),
  outputField: z.string().required(),
  indexName: z.string(),
  metricType: z.string().required(),
})

const CapabilityConfig = z.object({
  state: z.string().required(),
  fields: z.array(z.string()),
  routes: z.array(Bm25RouteConfig),
  blocker: z.string(),
  blockers: z.array(z.string()),
})

const CollectionInspectionConfig = z.object({
  name: z.string().required(),
  fields: z.array(CollectionFieldConfig).required(),
  retrievalSchema: z.object({
    schemaFingerprint: z.string().required(),
    bm25Routes: z.array(Bm25RouteConfig).required(),
    unsupportedSparseFields: z.array(z.string()).required(),
  }).required(),
  capabilities: z.object({
    dense: CapabilityConfig.required(),
    bm25: CapabilityConfig.required(),
    hybrid: CapabilityConfig.required(),
  }).required(),
})

const CollectionCheckResultConfig = z.object({
  profileId: z.string().required(),
  checkedAt: z.number().required(),
  state: z.string().required(),
  message: z.string().required(),
  collections: z.array(z.string()).required(),
  requestedCollection: z.string(),
  collection: z.union([
    CollectionInspectionConfig,
    z.const(null),
  ]).default(null),
})

export const ConnectionStatusConfig = z.object({
  request: z.object({
    profileId: z.string().required(),
    requestId: z.number().required(),
  }).default(null),
  checks: z.dict(CheckResultConfig).default({}),
  embeddingRequest: z.object({
    profileId: z.string().required(),
    requestId: z.number().required(),
  }).default(null),
  embeddingChecks: z.dict(CheckResultConfig).default({}),
  collectionRequest: z.object({
    profileId: z.string().required(),
    collection: z.string(),
    requestId: z.number().required(),
  }).default(null),
  collectionChecks: z.dict(CollectionCheckResultConfig).default({}),
})

const missingProfile = (profileId, checkedAt) => ({
  profileId,
  checkedAt,
  state: 'blocked',
  message: 'This profile is no longer configured.',
})

/**
 * Turn a browser's non-secret check request into a host-only Milvus probe.
 * The status namespace is deliberately separate from profile policy settings:
 * it carries a profile id, request nonce, and a safe result, never a token.
 */
export function attachConnectionStatusMonitor({
  statusScope,
  profileSource,
  resolveCredential,
  checkProfile = checkMilvusProfile,
  now = Date.now,
}) {
  let lastRequestKey = ''

  return statusScope.watch(async (status) => {
    const request = status.request
    if (!request) return
    const requestKey = `${request.profileId}:${request.requestId}`
    if (requestKey === lastRequestKey) return
    lastRequestKey = requestKey

    const profile = profileSource().profiles?.find((item) => item.id === request.profileId)
    const result = profile
      ? await checkProfile(profile, { resolveCredential, now })
      : missingProfile(request.profileId, now())

    // A later click wins. Do not let an older, slower probe overwrite it.
    const current = statusScope.get()
    if (current.request?.profileId !== request.profileId || current.request?.requestId !== request.requestId) return
    await statusScope.update({
      checks: { ...(current.checks ?? {}), [request.profileId]: result },
    })
  })
}

/** Process browser embedding-profile checks without exposing API keys. */
export function attachEmbeddingStatusMonitor({
  statusScope,
  profileSource,
  resolveCredential,
  checkProfile = checkEmbeddingProfile,
  now = Date.now,
}) {
  let lastRequestKey = ''

  return statusScope.watch(async (status) => {
    const request = status.embeddingRequest
    if (!request) return
    const requestKey = `${request.profileId}:${request.requestId}`
    if (requestKey === lastRequestKey) return
    lastRequestKey = requestKey

    const profile = profileSource().embeddingProfiles?.find((item) => item.id === request.profileId)
    const result = profile
      ? await checkProfile(profile, { resolveCredential, now })
      : missingProfile(request.profileId, now())

    const current = statusScope.get()
    if (current.embeddingRequest?.profileId !== request.profileId
      || current.embeddingRequest?.requestId !== request.requestId) return
    await statusScope.update({
      embeddingChecks: { ...(current.embeddingChecks ?? {}), [request.profileId]: result },
    })
  })
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

/** List and inspect one collection without exposing a browser-side Milvus client. */
export function attachCollectionStatusMonitor({
  statusScope,
  profileSource,
  createTransport,
  now = Date.now,
}) {
  let lastRequestKey = ''

  return statusScope.watch(async (status) => {
    const request = status.collectionRequest
    if (!request) return
    const requestKey = `${request.profileId}:${request.collection ?? ''}:${request.requestId}`
    if (requestKey === lastRequestKey) return
    lastRequestKey = requestKey

    const settings = profileSource()
    const profile = settings.profiles?.find((item) => item.id === request.profileId)
    let result
    if (!profile) {
      result = {
        ...missingProfile(request.profileId, now()),
        collections: [],
        ...(request.collection ? { requestedCollection: request.collection } : {}),
      }
    } else {
      const transport = createTransport(profile)
      const listed = await transport.listCollections()
      if (listed.kind === 'blocked') {
        result = {
          profileId: profile.id,
          checkedAt: now(),
          state: 'blocked',
          message: listed.message,
          collections: [],
          ...(request.collection ? { requestedCollection: request.collection } : {}),
        }
      } else if (!request.collection) {
        result = {
          profileId: profile.id,
          checkedAt: now(),
          state: 'ready',
          message: listed.collections.length
            ? `Found ${listed.collections.length} collection${listed.collections.length === 1 ? '' : 's'}.`
            : 'Connected, but this database has no collections.',
          collections: [...listed.collections].sort((left, right) => left.localeCompare(right)),
        }
      } else {
        const inspected = await transport.preflightCollection(request.collection)
        result = inspected.kind === 'blocked'
          ? {
              profileId: profile.id,
              checkedAt: now(),
              state: 'blocked',
              message: inspected.message,
              collections: [...listed.collections].sort((left, right) => left.localeCompare(right)),
              requestedCollection: request.collection,
            }
          : {
              profileId: profile.id,
              checkedAt: now(),
              state: 'ready',
              message: `Inspected ${inspected.collection.name}.`,
              collections: [...listed.collections].sort((left, right) => left.localeCompare(right)),
              requestedCollection: request.collection,
              collection: safeCollection(inspected.collection, settings, profile),
            }
      }
    }

    const current = statusScope.get()
    if (current.collectionRequest?.profileId !== request.profileId
      || current.collectionRequest?.collection !== request.collection
      || current.collectionRequest?.requestId !== request.requestId) return
    await statusScope.update({
      collectionChecks: { ...(current.collectionChecks ?? {}), [request.profileId]: result },
    })
  })
}
