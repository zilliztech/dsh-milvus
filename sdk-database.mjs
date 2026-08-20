/**
 * Resolve the database name handed to the Milvus SDK `HttpClient` for one
 * profile. This is the single source of truth for the Zilliz Serverless
 * database rule shared by the connection check and the read transport:
 * HttpClient defaults an omitted database to "default" and then adds it to
 * every request. Zilliz Serverless has no database concept, so an empty value
 * prevents that false default while keeping the Profile field optional.
 */
export function sdkDatabase(profile) {
  if (profile.database) return profile.database
  return profile.kind === 'zilliz-cloud' ? '' : undefined
}
