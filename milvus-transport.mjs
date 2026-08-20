import { HttpClient } from '@zilliz/milvus2-sdk-node'
import { sdkDatabase } from './sdk-database.mjs'

function normalizeField(field) {
  const name = field.name ?? field.fieldName
  const dataType = field.type ?? field.dataType
  return {
    name,
    dataType,
    kind: /vector/i.test(dataType) ? 'vector' : 'scalar',
    primaryKey: field.primaryKey === true || field.isPrimary === true,
  }
}

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

        return {
          kind: 'ready',
          collection: {
            name: description.data.collectionName,
            fields,
            indexes: description.data.indexes.map((index) => ({
              fieldName: index.fieldName,
              indexName: index.indexName,
              metricType: index.metricType,
            })),
            rowCount: statistics.data.rowCount,
            loadState: load.data.loadState,
            loadProgress: load.data.loadProgress,
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
    async queryCollection({ collectionName, filter, outputFields, limit }) {
      const connection = await resolveClient()
      if (connection.blocked) return connection.blocked
      try {
        const response = await connection.client.query({
          collectionName,
          ...databaseOptions(profile),
          ...(filter === undefined ? {} : { filter }),
          outputFields,
          limit,
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
  }
}
