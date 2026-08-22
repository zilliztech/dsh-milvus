function blocked(reason, message) {
  return { kind: 'blocked', reason, message }
}

export function resolveRetrievalBinding(settings, profile, collectionName, requestedVectorField) {
  const bindings = Array.isArray(settings?.retrievalBindings) ? settings.retrievalBindings : []
  const candidates = bindings.filter((binding) => binding.milvusProfileId === profile.id
    && binding.collection === collectionName
    && (requestedVectorField === undefined || binding.vectorField === requestedVectorField))
  if (!candidates.length) {
    return blocked('retrieval_binding_absent', 'Configure an embedding binding for this Milvus collection and vector field before using dense or hybrid search.')
  }
  if (candidates.length > 1) {
    return blocked('retrieval_binding_ambiguous', 'This collection has multiple embedding bindings. Supply the configured vectorField to choose one.')
  }

  const binding = candidates[0]
  const embeddingProfile = settings.embeddingProfiles?.find((item) => item.id === binding.embeddingProfileId)
  if (!embeddingProfile) {
    return blocked('embedding_profile_absent', 'The embedding profile selected by this retrieval binding is unavailable.')
  }
  return { binding, embeddingProfile }
}

export function resolveRetrievalPolicy(settings, profile, collectionName) {
  const policies = Array.isArray(settings?.retrievalPolicies) ? settings.retrievalPolicies : []
  const candidates = policies.filter((policy) => policy.milvusProfileId === profile.id
    && policy.collection === collectionName)
  return candidates.length === 1 ? candidates[0] : undefined
}

export function resolveBm25Route(settings, profile, collection, requestedTextField) {
  const routes = collection.retrievalSchema?.bm25Routes ?? []
  if (!routes.length) {
    if (collection.retrievalSchema?.unsupportedSparseFields?.length) {
      return blocked('sparse_encoder_binding_absent', 'This collection has a sparse vector field but no schema-proven Milvus BM25 Function route. This plugin does not guess an external sparse encoder.')
    }
    return blocked('bm25_route_absent', 'This collection does not expose a schema-proven Milvus BM25 Function route for text search.')
  }

  const policy = resolveRetrievalPolicy(settings, profile, collection.name)
  const policyMatchesSchema = policy
    && (!policy.schemaFingerprint || policy.schemaFingerprint === collection.retrievalSchema?.schemaFingerprint)

  if (requestedTextField !== undefined) {
    if (policy && !policyMatchesSchema) {
      return blocked('retrieval_plan_stale', 'The configured collection retrieval policy no longer matches the current schema. Review and save the BM25 route again.')
    }
    if (typeof requestedTextField !== 'string' || !requestedTextField.trim()) {
      return blocked('invalid_search', 'When supplied, textField must be a non-empty BM25 input field name.')
    }
    const matches = routes.filter((route) => route.inputField === requestedTextField)
    if (matches.length === 1) {
      return {
        route: matches[0],
        source: 'request',
        ...(policyMatchesSchema ? { policy } : {}),
      }
    }
    if (!matches.length) {
      return blocked('bm25_route_absent', `The field “${requestedTextField}” is not the input of a schema-proven BM25 Function route.`)
    }
    if (policyMatchesSchema) {
      const configured = matches.filter((route) => route.inputField === policy.textField
        && route.outputField === policy.sparseField)
      if (configured.length === 1) return { route: configured[0], source: 'collection_policy', policy }
    }
    return blocked('bm25_route_ambiguous', `The field “${requestedTextField}” maps to multiple BM25 routes; configure a collection retrieval policy before searching it.`)
  }

  if (policy) {
    if (policy.schemaFingerprint && policy.schemaFingerprint !== collection.retrievalSchema?.schemaFingerprint) {
      return blocked('retrieval_plan_stale', 'The configured collection retrieval policy no longer matches the current schema. Review and save the BM25 route again.')
    }
    const matches = routes.filter((route) => route.inputField === policy.textField
      && route.outputField === policy.sparseField)
    if (matches.length !== 1) {
      return blocked('retrieval_plan_stale', 'The configured BM25 route is no longer present in the current collection schema.')
    }
    return { route: matches[0], source: 'collection_policy', policy }
  }

  if (routes.length === 1) return { route: routes[0], source: 'schema_unique' }
  return blocked('bm25_route_ambiguous', 'This collection has multiple schema-proven BM25 routes. Supply the intended textField or configure a collection retrieval policy.')
}

export function collectionCapabilities(collection, settings, profile) {
  const bindings = (settings?.retrievalBindings ?? []).filter((binding) => binding.milvusProfileId === profile.id
    && binding.collection === collection.name)
  const validDenseFields = bindings.filter((binding) => {
    const field = collection.fields.find((item) => item.name === binding.vectorField)
    return field && /^floatvector$/i.test(field.dataType) && Number.isInteger(field.dimension)
      && settings?.embeddingProfiles?.some((item) => item.id === binding.embeddingProfileId)
  }).map((binding) => binding.vectorField)
  const bm25Routes = collection.retrievalSchema?.bm25Routes ?? []
  const bm25Resolution = resolveBm25Route(settings, profile, collection)
  const denseState = validDenseFields.length === 1 ? 'ready' : validDenseFields.length > 1 ? 'ambiguous' : 'blocked'
  const bm25State = bm25Resolution.kind !== 'blocked'
    ? 'ready'
    : bm25Resolution.reason === 'bm25_route_ambiguous'
      ? 'ambiguous'
      : 'blocked'
  const denseBlocker = denseState === 'ambiguous' ? 'retrieval_binding_ambiguous' : 'retrieval_binding_absent'
  const bm25Blocker = bm25Resolution.kind === 'blocked' ? bm25Resolution.reason : undefined
  return {
    dense: {
      state: denseState,
      fields: validDenseFields,
      ...(denseState !== 'ready' ? { blocker: denseBlocker } : {}),
    },
    bm25: {
      state: bm25State,
      routes: bm25State === 'ready' ? [bm25Resolution.route] : bm25Routes,
      ...(bm25Blocker ? { blocker: bm25Blocker } : {}),
    },
    hybrid: {
      state: denseState === 'ready' && bm25State === 'ready' ? 'ready' : 'blocked',
      ...(denseState === 'ready' && bm25State === 'ready'
        ? {}
        : { blockers: [
            ...(denseState === 'ready' ? [] : [denseBlocker]),
            ...(bm25State === 'ready' ? [] : [bm25Blocker]),
          ] }),
    },
  }
}
