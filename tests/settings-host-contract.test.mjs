import assert from 'node:assert/strict'
import test from 'node:test'

const localSettings = {
  activeProfileId: 'local-dev',
  profiles: [{
    id: 'local-dev',
    name: 'Local development',
    kind: 'local',
    endpoint: 'http://127.0.0.1:19530',
    database: 'default',
  }],
}

test('the host bundle exposes dsh 0.2 volatile settings and an authenticated status route', async () => {
  const {
    apply,
    Config,
    MILVUS_SETTINGS_NAMESPACE,
    MILVUS_STATUS_ROUTE,
  } = await import('../index.mjs')
  const registeredTools = []
  const promptSections = []
  const settingsPolicies = []
  let statusRegistration
  let onAgentCreated

  const ctx = {
    fiber: { state: 'active' },
    on(event, handler) {
      if (event === 'agent/created') onAgentCreated = handler
    },
    inject(dependencies, callback) {
      const child = {
        effect(register) { return register() },
        settings: {
          configure(policy, fiber) {
            settingsPolicies.push({ policy, fiber })
            return () => {}
          },
        },
        connection: {
          fetch: {
            register(route) {
              statusRegistration = route
              return () => {}
            },
          },
        },
        credentials: { resolve: async () => undefined },
        tools: { register: (tool) => registeredTools.push(tool) },
        systemPrompt: { section: (section) => promptSections.push(section) },
      }
      if ([
        ['settings'],
        ['connection', 'credentials'],
        ['credentials', 'tools', 'systemPrompt'],
      ].some((expected) => JSON.stringify(expected) === JSON.stringify(dependencies))) callback(child)
    },
  }

  const config = Config(localSettings)
  apply(ctx, config)

  assert.equal(MILVUS_SETTINGS_NAMESPACE, 'dsh-milvus')
  assert.equal(config.profiles.get()[0].id, 'local-dev')
  assert.deepEqual(settingsPolicies, [{ policy: { auto: false }, fiber: ctx.fiber }])
  assert.equal(statusRegistration.path, MILVUS_STATUS_ROUTE)
  assert.deepEqual(statusRegistration.methods, ['POST'])
  assert.equal(statusRegistration.requestBody, 'buffered')
  assert.equal(typeof statusRegistration.fetch, 'function')
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

  const session = { snapshotEvents: () => Object.freeze([]) }
  onAgentCreated({ agent: { session }, source: 'startup' })
  const response = await statusRegistration.fetch(new Request(`http://localhost${MILVUS_STATUS_ROUTE}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ method: 'unknown', payload: {} }),
  }))
  const unknown = await response.json()
  assert.equal(unknown.ok, false)
  assert.equal(unknown.error.code, 'dsh-milvus/not-found')
})

test('the status route registers before optional tool services are ready', async () => {
  const { apply, Config, MILVUS_STATUS_ROUTE } = await import('../index.mjs')
  let registeredPath
  const ctx = {
    fiber: {},
    on() {},
    inject(dependencies, callback) {
      if (JSON.stringify(dependencies) === JSON.stringify(['settings'])) {
        callback({
          effect(register) { return register() },
          settings: { configure: () => () => {} },
        })
      }
      if (JSON.stringify(dependencies) === JSON.stringify(['connection', 'credentials'])) {
        callback({
          connection: {
            fetch: {
              register(route) {
                registeredPath = route.path
                return () => {}
              },
            },
          },
          credentials: { resolve: async () => undefined },
        })
      }
    },
  }

  apply(ctx, Config({}))

  assert.equal(registeredPath, MILVUS_STATUS_ROUTE)
})
