const range = (minimum, maximum) => ({ kind: 'range', minimum, maximum })
const values = (...supported) => ({ kind: 'values', values: supported })
const fixed = (dimension) => ({ kind: 'fixed', dimension })

export const EMBEDDING_PROVIDER_CATALOG = Object.freeze({
  openai: {
    label: 'OpenAI',
    defaultModel: 'text-embedding-3-small',
    models: {
      'text-embedding-3-small': { dimensions: range(1, 1_536), probeDimension: 128 },
      'text-embedding-3-large': { dimensions: range(1, 3_072), probeDimension: 128 },
      'text-embedding-ada-002': { dimensions: fixed(1_536), probeDimension: 1_536 },
    },
  },
  gemini: {
    label: 'Google Gemini',
    defaultModel: 'gemini-embedding-2',
    models: {
      'gemini-embedding-2': { dimensions: range(128, 3_072), probeDimension: 128 },
      'gemini-embedding-001': { dimensions: range(128, 3_072), probeDimension: 128 },
    },
  },
  cohere: {
    label: 'Cohere',
    defaultModel: 'embed-v4.0',
    models: {
      'embed-v4.0': { dimensions: values(256, 512, 1_024, 1_536), probeDimension: 256 },
      'embed-english-v3.0': { dimensions: fixed(1_024), probeDimension: 1_024 },
      'embed-english-light-v3.0': { dimensions: fixed(384), probeDimension: 384 },
      'embed-multilingual-v3.0': { dimensions: fixed(1_024), probeDimension: 1_024 },
      'embed-multilingual-light-v3.0': { dimensions: fixed(384), probeDimension: 384 },
    },
  },
  voyage: {
    label: 'Voyage AI',
    defaultModel: 'voyage-4',
    models: {
      'voyage-4-large': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-4': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-4-lite': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-code-4': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-3.5': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-3.5-lite': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-code-3': { dimensions: values(256, 512, 1_024, 2_048), probeDimension: 256 },
      'voyage-finance-2': { dimensions: fixed(1_024), probeDimension: 1_024 },
      'voyage-law-2': { dimensions: fixed(1_024), probeDimension: 1_024 },
    },
  },
  mistral: {
    label: 'Mistral AI',
    defaultModel: 'mistral-embed',
    models: {
      'mistral-embed': { dimensions: fixed(1_024), probeDimension: 1_024 },
      'codestral-embed': { dimensions: range(1, 3_072), probeDimension: 256 },
    },
  },
  jina: {
    label: 'Jina AI',
    defaultModel: 'jina-embeddings-v5-text-small',
    models: {
      'jina-embeddings-v5-text-small': {
        dimensions: values(32, 64, 128, 256, 512, 768, 1_024),
        probeDimension: 32,
      },
      'jina-embeddings-v5-text-nano': {
        dimensions: values(32, 64, 128, 256, 512, 768),
        probeDimension: 32,
      },
      'jina-embeddings-v5-omni-small': {
        dimensions: values(32, 64, 128, 256, 512, 768, 1_024),
        probeDimension: 32,
      },
      'jina-embeddings-v5-omni-nano': {
        dimensions: values(32, 64, 128, 256, 512, 768),
        probeDimension: 32,
      },
      'jina-embeddings-v4': {
        dimensions: values(128, 256, 512, 1_024, 2_048),
        probeDimension: 128,
      },
      'jina-embeddings-v3': {
        dimensions: values(32, 64, 128, 256, 512, 768, 1_024),
        probeDimension: 32,
      },
    },
  },
  together: {
    label: 'Together AI',
    defaultModel: 'intfloat/multilingual-e5-large-instruct',
    models: {
      'intfloat/multilingual-e5-large-instruct': { dimensions: fixed(1_024), probeDimension: 1_024 },
    },
  },
})

export const EMBEDDING_PROVIDERS = Object.freeze(Object.keys(EMBEDDING_PROVIDER_CATALOG))

export function embeddingModelsFor(provider) {
  return Object.keys(EMBEDDING_PROVIDER_CATALOG[provider]?.models ?? {})
}

export function embeddingModelDefinition(provider, model) {
  return EMBEDDING_PROVIDER_CATALOG[provider]?.models?.[model]
}

export function embeddingProbeDimension(profile) {
  return embeddingModelDefinition(profile?.provider, profile?.model)?.probeDimension
}

function supportsDimension(definition, dimension) {
  if (definition.kind === 'fixed') return dimension === definition.dimension
  if (definition.kind === 'values') return definition.values.includes(dimension)
  return dimension >= definition.minimum && dimension <= definition.maximum
}

export function validateEmbeddingModelDimension(profile, dimension) {
  const provider = EMBEDDING_PROVIDER_CATALOG[profile?.provider]
  if (!provider) {
    return {
      reason: 'embedding_provider_unsupported',
      message: 'The configured embedding provider is unsupported.',
    }
  }
  const model = provider.models[profile?.model]
  if (!model) {
    return {
      reason: 'embedding_model_unsupported',
      message: 'The configured embedding model is unsupported.',
    }
  }
  if (!supportsDimension(model.dimensions, dimension)) {
    return {
      reason: 'unsupported_vector_dimension',
      message: 'The configured embedding model cannot produce the target Milvus vector dimension.',
    }
  }
}
