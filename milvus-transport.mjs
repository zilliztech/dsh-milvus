import { HttpClient } from '@zilliz/milvus2-sdk-node'
import { sdkDatabase } from './sdk-database.mjs'
import { inspectRetrievalSchema, normalizeField, normalizeFunction, normalizeIndex } from './retrieval-schema.mjs'

function databaseOptions(profile, request = {}) {
  return profile.database ? { ...request, dbName: profile.database } : request
}

/**
 * Plugin-owned read transport. Its small interface deliberately exposes only
 * product operations; callers cannot pass SDK request objects or a database.
 */
export function createMilvusTransport({
  profile,
  resolveCredential,
  createClient = (options) => new HttpClient(options),
} = {}) {
  function clientForProfile(resolved) {
    const database = sdkDatabase(profile)
    return createClient({
      endpoint: profile.endpoint,
      ...(database === undefined ? {} : { database }),
      ...(resolved?.value ? { token: resolved.value } : {}),
      timeout: 10_000,
    })
  }

  async function resolveClient() {
    if (!profile) {
      return {
        blocked: {
          kind: 'blocked',
          reason: 'profile_unavailable',
          message: 'Select a Milvus deployment profile before using this operation.',
        },
      }
    }
    let resolved
    try {
      resolved = profile.credentialRef
        ? await resolveCredential(profile.credentialRef)
        : undefined
    } catch {
      return {
        blocked: {
          kind: 'blocked',
          reason: 'credential_unavailable',
          message: 'The selected profile credential is unavailable.',
        },
      }
    }
    if (profile.credentialRef && !resolved?.value) {
      return {
        blocked: {
          kind: 'blocked',
          reason: 'credential_unavailable',
          message: 'The selected profile credential is unavailable.',
        },
      }
    }
    return { client: clientForProfile(resolved) }
  }

  return {
    async listCollections() {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const response = await connection.client.listCollections(databaseOptions(profile))
        return { kind: 'ready', collections: response.data }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
    async preflightCollection(collectionName) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const { client } = connection
        const collections = await client.listCollections(databaseOptions(profile))
        if (!collections.data.includes(collectionName)) {
          return {
            kind: 'blocked',
            reason: 'collection_absent',
            message: 'The selected collection is not available in this profile.',
          }
        }

        const [description, statistics, load] = await Promise.all([
          client.describeCollection(databaseOptions(profile, { collectionName })),
          client.getCollectionStatistics(databaseOptions(profile, { collectionName })),
          client.getCollectionLoadState(databaseOptions(profile, { collectionName })),
        ])
        const fields = description.data.fields.map(normalizeField)
        if (!fields.length || fields.some((field) => typeof field.name !== 'string' || !field.name || typeof field.dataType !== 'string' || !field.dataType)) {
          return {
            kind: 'blocked',
            reason: 'unsupported_schema',
            message: 'The collection schema cannot support a controlled scalar query.',
          }
        }

        const indexes = (description.data.indexes ?? []).map(normalizeIndex)
        const functions = (description.data.functions ?? []).map(normalizeFunction)
        return {
          kind: 'ready',
          collection: {
            name: description.data.collectionName,
            ...(description.data.description ? { description: description.data.description } : {}),
            fields,
            indexes,
            functions,
            retrievalSchema: inspectRetrievalSchema(fields, indexes, functions),
            rowCount: statistics.data.rowCount,
            loadState: load.data.loadState,
            loadProgress: load.data.loadProgress,
            ...(Number.isInteger(description.data.shardsNum) ? { shardsNum: description.data.shardsNum } : {}),
            ...(typeof description.data.enableDynamicField === 'boolean'
              ? { enableDynamicField: description.data.enableDynamicField }
              : {}),
          },
        }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
    async queryCollection({ collectionName, filter, outputFields, limit, partitionNames }) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const response = await connection.client.query({
          collectionName,
          ...databaseOptions(profile),
          ...(filter === undefined ? {} : { filter }),
          outputFields,
          limit,
          ...(partitionNames === undefined ? {} : { partitionNames }),
        })
        if (response.code !== 0 || !Array.isArray(response.data)) {
          return {
            kind: 'blocked',
            reason: 'query_rejected',
            message: 'Milvus could not complete the controlled query for this collection.',
          }
        }
        return { kind: 'ready', rows: response.data }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
    async getCollection({ collectionName, ids, outputFields }) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const response = await connection.client.get(databaseOptions(profile, {
          collectionName,
          id: ids,
          outputFields,
        }))
        if (response.code !== 0 || !Array.isArray(response.data)) {
          return {
            kind: 'blocked',
            reason: 'get_rejected',
            message: 'Milvus could not retrieve the requested primary keys from this collection.',
          }
        }
        return { kind: 'ready', rows: response.data }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
    async searchCollection({ collectionName, vector, vectorField, filter, outputFields, limit, partitionNames, searchParams }) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const response = await connection.client.search(databaseOptions(profile, {
          collectionName,
          data: [vector],
          annsField: vectorField,
          ...(filter === undefined ? {} : { filter }),
          outputFields,
          limit,
          ...(partitionNames === undefined ? {} : { partitionNames }),
          ...(searchParams === undefined ? {} : { searchParams }),
        }))
        const rows = Array.isArray(response.data)
          ? response.data
          : response.data && typeof response.data === 'object'
            ? [response.data]
            : undefined
        if (response.code !== 0 || !rows) {
          return {
            kind: 'blocked',
            reason: 'search_rejected',
            message: 'Milvus could not complete the dense search for this collection.',
          }
        }
        return { kind: 'ready', rows }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
    async textSearchCollection({ collectionName, queryText, sparseField, filter, outputFields, limit, partitionNames, searchParams }) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const response = await connection.client.search(databaseOptions(profile, {
          collectionName,
          data: [queryText],
          annsField: sparseField,
          ...(filter === undefined ? {} : { filter }),
          outputFields,
          limit,
          ...(partitionNames === undefined ? {} : { partitionNames }),
          ...(searchParams === undefined ? {} : { searchParams }),
        }))
        const rows = Array.isArray(response.data)
          ? response.data
          : response.data && typeof response.data === 'object'
            ? [response.data]
            : undefined
        if (response.code !== 0 || !rows) {
          return {
            kind: 'blocked',
            reason: 'text_search_rejected',
            message: 'Milvus could not complete the BM25 text search for this collection.',
          }
        }
        return { kind: 'ready', rows }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
    async hybridSearchCollection({ collectionName, vector, denseField, queryText, sparseField, filter, outputFields, limit, partitionNames, rerank }) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const route = ({ data, annsField }) => ({
          data,
          annsField,
          limit,
          ...(filter === undefined ? {} : { filter }),
        })
        const response = await connection.client.hybridSearch(databaseOptions(profile, {
          collectionName,
          search: [
            route({ data: [vector], annsField: denseField }),
            route({ data: [queryText], annsField: sparseField }),
          ],
          rerank,
          ...(partitionNames === undefined ? {} : { partitionNames }),
          outputFields,
          limit,
        }))
        const rows = Array.isArray(response.data)
          ? response.data
          : response.data && typeof response.data === 'object'
            ? [response.data]
            : undefined
        if (response.code !== 0 || !rows) {
          return {
            kind: 'blocked',
            reason: 'hybrid_search_rejected',
            message: 'Milvus could not complete the dense and BM25 hybrid search for this collection.',
          }
        }
        return { kind: 'ready', rows }
      } catch {
        return {
          kind: 'blocked',
          reason: 'deployment_unreachable',
          message: 'The selected Milvus deployment could not be reached.',
        }
      }
    },
  }
}
