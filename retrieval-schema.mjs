import { createHash } from 'node:crypto'

function normalizeParams(value) {
  if (Array.isArray(value)) {
    return Object.fromEntries(value
      .filter((item) => item && typeof item.key === 'string')
      .map((item) => [item.key, item.value]))
  }
  return value && typeof value === 'object' ? value : {}
}

function booleanParam(value) {
  return value === true || String(value).toLowerCase() === 'true'
}

function functionType(value) {
  if (value === 1 || String(value).toUpperCase() === 'BM25') return 'BM25'
  return String(value ?? 'Unknown')
}

export function normalizeField(field) {
  const name = field.name ?? field.fieldName
  const dataType = field.type ?? field.dataType
  const params = normalizeParams(field.params ?? field.elementTypeParams)
  const rawDimension = field.dimension ?? field.dim ?? field.elementTypeParams?.dim ?? params.dim
  const dimension = Number(rawDimension)
  return {
    name,
    dataType,
    kind: /vector/i.test(dataType) ? 'vector' : 'scalar',
    primaryKey: field.primaryKey === true || field.isPrimary === true,
    ...(Number.isInteger(dimension) && dimension > 0 ? { dimension } : {}),
    ...(booleanParam(params.enable_analyzer ?? params.enableAnalyzer)
      ? { analyzerEnabled: true }
      : {}),
    ...(field.isFunctionOutput === true ? { functionOutput: true } : {}),
  }
}

export function normalizeIndex(index) {
  const params = normalizeParams(index.params ?? index.indexParams)
  return {
    fieldName: index.fieldName ?? index.field_name,
    ...(index.indexName ?? index.index_name ? { indexName: index.indexName ?? index.index_name } : {}),
    ...(index.indexType ?? index.index_type ? { indexType: index.indexType ?? index.index_type } : {}),
    ...(index.metricType ?? index.metric_type ? { metricType: index.metricType ?? index.metric_type } : {}),
    ...(Object.keys(params).length ? { params } : {}),
  }
}

export function normalizeFunction(fn) {
  return {
    name: fn.name,
    type: functionType(fn.type ?? fn.functionType ?? fn.function_type),
    inputFieldNames: fn.inputFieldNames ?? fn.input_field_names ?? [],
    outputFieldNames: fn.outputFieldNames ?? fn.output_field_names ?? [],
    ...(fn.description ? { description: fn.description } : {}),
    ...(fn.params && typeof fn.params === 'object' ? { params: fn.params } : {}),
  }
}

function stableCollectionFacts(fields, indexes, functions) {
  return {
    fields: fields
      .map(({ name, dataType, dimension, analyzerEnabled, functionOutput }) => ({
        name,
        dataType,
        ...(dimension === undefined ? {} : { dimension }),
        analyzerEnabled: analyzerEnabled === true,
        functionOutput: functionOutput === true,
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
    indexes: indexes
      .map(({ fieldName, indexName, indexType, metricType }) => ({
        fieldName,
        ...(indexName ? { indexName } : {}),
        ...(indexType ? { indexType } : {}),
        ...(metricType ? { metricType } : {}),
      }))
      .sort((left, right) => `${left.fieldName}\0${left.indexName ?? ''}`.localeCompare(`${right.fieldName}\0${right.indexName ?? ''}`)),
    functions: functions
      .map(({ name, type, inputFieldNames, outputFieldNames }) => ({
        name,
        type,
        inputFieldNames: [...inputFieldNames],
        outputFieldNames: [...outputFieldNames],
      }))
      .sort((left, right) => left.name.localeCompare(right.name)),
  }
}

export function inspectRetrievalSchema(fields, indexes, functions) {
  const fieldsByName = new Map(fields.map((field) => [field.name, field]))
  const bm25Routes = []
  for (const fn of functions.filter((item) => item.type === 'BM25')) {
    if (fn.inputFieldNames.length !== 1 || fn.outputFieldNames.length !== 1) continue
    const inputField = fieldsByName.get(fn.inputFieldNames[0])
    const outputField = fieldsByName.get(fn.outputFieldNames[0])
    const index = indexes.find((item) => item.fieldName === outputField?.name && /^bm25$/i.test(item.metricType ?? ''))
    if (!inputField || !outputField || !index) continue
    if (!/^(varchar|text)$/i.test(inputField.dataType) || inputField.analyzerEnabled !== true) continue
    if (!/^sparsefloatvector$/i.test(outputField.dataType)) continue
    bm25Routes.push({
      functionName: fn.name,
      inputField: inputField.name,
      outputField: outputField.name,
      ...(index.indexName ? { indexName: index.indexName } : {}),
      metricType: 'BM25',
    })
  }
  bm25Routes.sort((left, right) => `${left.inputField}\0${left.outputField}`.localeCompare(`${right.inputField}\0${right.outputField}`))

  const routeOutputs = new Set(bm25Routes.map((route) => route.outputField))
  const unsupportedSparseFields = fields
    .filter((field) => /^sparsefloatvector$/i.test(field.dataType) && !routeOutputs.has(field.name))
    .map((field) => field.name)
    .sort()
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(stableCollectionFacts(fields, indexes, functions)))
    .digest('hex')

  return {
    schemaFingerprint: `sha256:${fingerprint}`,
    bm25Routes,
    unsupportedSparseFields,
  }
}
