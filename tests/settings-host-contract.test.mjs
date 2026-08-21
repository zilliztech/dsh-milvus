import assert from 'node:assert/strict'
import test from 'node:test'

test('the host bundle declares the stable Milvus settings namespace', async () => {
  const host = await import('../index.mjs')

  assert.equal(host.name, 'dsh-milvus')
  assert.equal(host.MILVUS_SETTINGS_NAMESPACE, 'dsh-milvus')
  assert.equal(typeof host.apply, 'function')
})

test('the host registers the Milvus settings namespace when dsh provides settings', async () => {
  const { apply, MILVUS_SETTINGS_NAMESPACE, MILVUS_STATUS_NAMESPACE } = await import('../index.mjs')
  const registrations = []
  const profileScope = {
    get: () => ({
      activeProfileId: 'local-dev',
      profiles: [{
        id: 'local-dev',
        name: 'Local development',
        kind: 'local',
        endpoint: 'http://127.0.0.1:19530',
        database: 'default',
      }],
    }),
    watch: () => () => {},
  }
  const statusScope = {
    get: () => ({}),
    watch: () => () => {},
    update: async () => {},
  }
  const registeredTools = []
  const promptSections = []
  let onSessionStart

  const ctx = {
    fiber: { state: 'active' },
    inject(dependencies, callback) {
      assert.ok([
        ['settings'],
        ['settings', 'credentials'],
        ['settings', 'credentials', 'tools'],
        ['settings', 'credentials', 'tools', 'systemPrompt'],
        ['credentials', 'tools', 'systemPrompt'],
      ].some((expected) => JSON.stringify(expected) === JSON.stringify(dependencies)))
      callback({
        effect(register) {
          register()
        },
        get(name) {
          return name === 'credentials' ? this.credentials : undefined
        },
        settings: {
          register(namespace, schema, options) {
            registrations.push({ namespace, schema, options })
            return namespace === MILVUS_SETTINGS_NAMESPACE ? profileScope : statusScope
          },
        },
        credentials: { resolve: async () => undefined },
        tools: { register: (tool) => registeredTools.push(tool) },
        systemPrompt: { section: (section) => promptSections.push(section) },
        on(event, handler) {
          if (event === 'agent/session-start') onSessionStart = handler
        },
      })
    },
  }

  apply(ctx, {
    activeProfileId: 'local-dev',
    profiles: [{
      id: 'local-dev',
      name: 'Local development',
      kind: 'local',
      endpoint: 'http://127.0.0.1:19530',
      database: 'default',
    }],
  })

  assert.equal(registrations[0]?.namespace, MILVUS_SETTINGS_NAMESPACE)
  assert.equal(registrations[0]?.options.base.activeProfileId, 'local-dev')
  assert.equal(registrations[1]?.namespace, MILVUS_STATUS_NAMESPACE)
  assert.deepEqual(registeredTools.map((tool) => tool.name), [
    'milvus_list_collections',
    'milvus_describe_collection',
    'milvus_get',
    'milvus_query',
    'milvus_search',
    'milvus_text_search',
    'milvus_hybrid_search',
  ])
  assert.match(promptSections[0]?.text ?? '', /ask the user/i)

  const session = {
    events: [],
    append(type, data) { this.events.push({ type, data }) },
  }
  onSessionStart({ agent: { session } })
  assert.deepEqual(session.events, [])
})

test('the connection-check status channel registers with Settings before optional tool services are ready', async () => {
  const { apply, MILVUS_SETTINGS_NAMESPACE, MILVUS_STATUS_NAMESPACE } = await import('../index.mjs')
  const registrations = []
  const profileScope = { get: () => ({ profiles: [], activeProfileId: '' }), watch: () => () => {} }
  const statusScope = { get: () => ({}), watch: () => () => {}, update: async () => {} }

  const ctx = {
    inject(dependencies, callback) {
      if (JSON.stringify(dependencies) !== JSON.stringify(['settings'])) return
      callback({
        effect(register) { register() },
        get: () => undefined,
        settings: {
          register(namespace, schema, options) {
            registrations.push({ namespace, schema, options })
            return namespace === MILVUS_SETTINGS_NAMESPACE ? profileScope : statusScope
          },
        },
      })
    },
  }

  apply(ctx, {})

  assert.deepEqual(registrations.map(({ namespace }) => namespace), [
    MILVUS_SETTINGS_NAMESPACE,
    MILVUS_STATUS_NAMESPACE,
  ])
})
