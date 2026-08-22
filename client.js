/* Browser half of Milvus for DSH. React is supplied by dsh's module loader. */
globalThis.__ModuleLoader__.load({
  id: '@zilliz/dsh-milvus',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement
    const SETTINGS_NAMESPACE = 'dsh-milvus'
    const STATUS_NAMESPACE = 'dsh-milvus-status'

    const defaultIdentity = (kind) => kind === 'zilliz-cloud'
      ? { id: 'zilliz-cloud', name: 'Zilliz Cloud' }
      : { id: 'local', name: 'Local Milvus' }
    const nextIdentity = (kind, profiles) => {
      const base = defaultIdentity(kind)
      const ids = new Set(profiles.map((profile) => profile.id))
      const names = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase()))
      for (let ordinal = 1; ; ordinal += 1) {
        const identity = ordinal === 1
          ? base
          : { id: `${base.id}-${ordinal}`, name: `${base.name} ${ordinal}` }
        if (!ids.has(identity.id) && !names.has(identity.name.toLocaleLowerCase())) return identity
      }
    }
    const credentialRefFor = (id) => {
      const suffix = String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')
      return suffix ? `DSH_MILVUS_${suffix}_TOKEN` : ''
    }
    const embeddingDefaults = {
      openai: { id: 'openai-embedding', name: 'OpenAI Embedding', model: 'text-embedding-3-small' },
      gemini: { id: 'gemini-embedding', name: 'Gemini Embedding', model: 'gemini-embedding-001' },
    }
    const embeddingModelsFor = (provider) => provider === 'gemini'
      ? ['gemini-embedding-001', 'gemini-embedding-2']
      : ['text-embedding-3-small', 'text-embedding-3-large']
    const nextEmbeddingIdentity = (provider, profiles) => {
      const base = embeddingDefaults[provider]
      const ids = new Set(profiles.map((profile) => profile.id))
      const names = new Set(profiles.map((profile) => profile.name.trim().toLocaleLowerCase()))
      for (let ordinal = 1; ; ordinal += 1) {
        const identity = ordinal === 1
          ? { id: base.id, name: base.name }
          : { id: `${base.id}-${ordinal}`, name: `${base.name} ${ordinal}` }
        if (!ids.has(identity.id) && !names.has(identity.name.toLocaleLowerCase())) return identity
      }
    }
    const embeddingCredentialRefFor = (provider, id) => {
      const suffix = String(id).toUpperCase().replace(/[^A-Z0-9]/g, '_')
      return suffix ? `DSH_EMBEDDING_${provider.toUpperCase()}_${suffix}_API_KEY` : ''
    }
    const emptyEmbeddingDraft = (provider = 'openai', profiles = []) => {
      const identity = nextEmbeddingIdentity(provider, profiles)
      return {
        ...identity,
        provider,
        model: embeddingDefaults[provider].model,
        credentialRef: embeddingCredentialRefFor(provider, identity.id),
      }
    }
    const bindingKey = (binding) => [binding.milvusProfileId, binding.collection, binding.vectorField].join('\u0000')
    const policyKey = (policy) => [policy.milvusProfileId, policy.collection].join('\u0000')
    const emptyDraft = (kind = 'local', profiles = []) => {
      const identity = nextIdentity(kind, profiles)
      return {
        ...identity,
        kind,
        endpoint: kind === 'local' ? 'http://127.0.0.1:19530' : '',
        database: kind === 'local' ? 'default' : '',
        credentialRef: kind === 'zilliz-cloud' ? credentialRefFor(identity.id) : '',
      }
    }
    const draftOf = (profile, profiles = []) => profile
      ? { ...emptyDraft(profile.kind, profiles), ...profile }
      : emptyDraft('local', profiles)

    /** A status-only credential projection. It never stores a token value. */
    class MilvusProfileController {
      constructor(scope, statusScope, api) {
        this.scope = scope
        this.statusScope = statusScope
        this.api = api
        this.listeners = new Set()
        this.credentials = {}
        this.pending = false
        this.error = ''
        this.requestId = Date.now()
        this.snapshot = this.buildSnapshot()
        scope.subscribe(() => {
          this.readCredentials()
          this.emit()
        })
        statusScope.subscribe(() => this.emit())
        this.readCredentials()
      }

      buildSnapshot() {
        const section = this.scope.getSnapshot().value ?? {}
        const status = this.statusScope.getSnapshot().value ?? {}
        return {
          profiles: Array.isArray(section.profiles) ? section.profiles : [],
          activeProfileId: typeof section.activeProfileId === 'string' ? section.activeProfileId : '',
          embeddingProfiles: Array.isArray(section.embeddingProfiles) ? section.embeddingProfiles : [],
          retrievalBindings: Array.isArray(section.retrievalBindings) ? section.retrievalBindings : [],
          retrievalPolicies: Array.isArray(section.retrievalPolicies) ? section.retrievalPolicies : [],
          credentials: this.credentials,
          checks: status.checks ?? {},
          embeddingChecks: status.embeddingChecks ?? {},
          collectionChecks: status.collectionChecks ?? {},
          pending: this.pending,
          error: this.error,
        }
      }

      getSnapshot = () => this.snapshot

      subscribe = (listener) => {
        this.listeners.add(listener)
        return () => this.listeners.delete(listener)
      }

      emit() {
        this.snapshot = this.buildSnapshot()
        for (const listener of this.listeners) listener()
      }

      nextRequestId() {
        this.requestId += 1
        return this.requestId
      }

      async readCredentials(additionalRefs = []) {
        const refs = [...new Set([
          ...this.getSnapshot().profiles.map((profile) => profile.credentialRef),
          ...this.getSnapshot().embeddingProfiles.map((profile) => profile.credentialRef),
          ...additionalRefs,
        ].filter(Boolean))]
        if (!refs.length) {
          this.credentials = {}
          this.emit()
          return
        }
        try {
          const response = await this.api.credentials.describe({ refs })
          if (!response.result?.ok) return
          const rows = response.result.value?.credentials ?? {}
          this.credentials = Object.fromEntries(refs.map((ref) => [ref, {
            configured: rows[ref]?.configured === true,
            writable: rows[ref]?.writable !== false,
            source: rows[ref]?.source,
          }]))
          this.emit()
        } catch {
          // A status read must not clear configuration or expose provider errors.
        }
      }

      async run(work) {
        this.error = ''
        this.pending = true
        this.emit()
        try {
          return await work()
        } catch (error) {
          this.error = error instanceof Error ? error.message : 'Could not update Milvus settings.'
          this.emit()
          return undefined
        } finally {
          this.pending = false
          this.emit()
        }
      }

      async saveProfile(draft, originalId) {
        const current = this.getSnapshot()
        const existing = current.profiles.find((item) => item.id === originalId)
        const identity = existing
          ? { id: existing.id, name: existing.name }
          : nextIdentity(draft.kind, current.profiles)
        const profile = {
          ...identity,
          kind: draft.kind,
          endpoint: String(draft.endpoint).trim(),
          ...(String(draft.database ?? '').trim() ? { database: String(draft.database).trim() } : {}),
          ...(draft.credentialRef?.trim() ? { credentialRef: draft.credentialRef.trim() } : {}),
        }
        if (profile.kind === 'zilliz-cloud' && !profile.credentialRef) profile.credentialRef = credentialRefFor(profile.id)
        return this.run(async () => {
          const profiles = existing
            ? current.profiles.map((item) => item.id === originalId ? profile : item)
            : [...current.profiles, profile]
          await this.scope.set('profiles', profiles)
          if (!current.activeProfileId) await this.scope.set('activeProfileId', profile.id)
          return profile
        })
      }

      selectProfile(id) {
        return this.run(() => this.scope.set('activeProfileId', id))
      }

      removeProfile(id) {
        return this.run(async () => {
          const current = this.getSnapshot()
          const profiles = current.profiles.filter((profile) => profile.id !== id)
          const retrievalBindings = current.retrievalBindings.filter((binding) => binding.milvusProfileId !== id)
          const retrievalPolicies = current.retrievalPolicies.filter((policy) => policy.milvusProfileId !== id)
          const nextActive = current.activeProfileId === id ? (profiles[0]?.id ?? '') : current.activeProfileId
          if (retrievalBindings.length !== current.retrievalBindings.length) await this.scope.set('retrievalBindings', retrievalBindings)
          if (retrievalPolicies.length !== current.retrievalPolicies.length) await this.scope.set('retrievalPolicies', retrievalPolicies)
          if (nextActive !== current.activeProfileId) await this.scope.set('activeProfileId', nextActive)
          await this.scope.set('profiles', profiles)
        })
      }

      async saveEmbeddingProfile(draft, originalId) {
        const current = this.getSnapshot()
        const existing = current.embeddingProfiles.find((item) => item.id === originalId)
        const identity = existing
          ? { id: existing.id, name: existing.name }
          : nextEmbeddingIdentity(draft.provider, current.embeddingProfiles)
        const profile = {
          ...identity,
          provider: draft.provider,
          model: String(draft.model).trim(),
          credentialRef: String(draft.credentialRef || embeddingCredentialRefFor(draft.provider, identity.id)).trim(),
        }
        return this.run(async () => {
          const embeddingProfiles = existing
            ? current.embeddingProfiles.map((item) => item.id === originalId ? profile : item)
            : [...current.embeddingProfiles, profile]
          await this.scope.set('embeddingProfiles', embeddingProfiles)
          return profile
        })
      }

      removeEmbeddingProfile(id) {
        return this.run(async () => {
          const current = this.getSnapshot()
          const retrievalBindings = current.retrievalBindings.filter((binding) => binding.embeddingProfileId !== id)
          if (retrievalBindings.length !== current.retrievalBindings.length) await this.scope.set('retrievalBindings', retrievalBindings)
          await this.scope.set('embeddingProfiles', current.embeddingProfiles.filter((profile) => profile.id !== id))
        })
      }

      saveRetrievalBinding(draft, originalKey) {
        return this.run(async () => {
          const current = this.getSnapshot()
          const binding = {
            milvusProfileId: draft.milvusProfileId,
            collection: String(draft.collection).trim(),
            vectorField: String(draft.vectorField).trim(),
            embeddingProfileId: draft.embeddingProfileId,
          }
          const retrievalBindings = originalKey
            ? current.retrievalBindings.map((item) => bindingKey(item) === originalKey ? binding : item)
            : [...current.retrievalBindings, binding]
          await this.scope.set('retrievalBindings', retrievalBindings)
          return binding
        })
      }

      removeRetrievalBinding(key) {
        return this.run(async () => {
          const current = this.getSnapshot()
          await this.scope.set('retrievalBindings', current.retrievalBindings.filter((binding) => bindingKey(binding) !== key))
        })
      }

      saveRetrievalPolicy(draft, originalKey) {
        return this.run(async () => {
          const current = this.getSnapshot()
          const existing = current.retrievalPolicies.find((item) => policyKey(item) === originalKey)
          const route = {
            milvusProfileId: draft.milvusProfileId,
            collection: String(draft.collection).trim(),
            textField: String(draft.textField).trim(),
            sparseField: String(draft.sparseField).trim(),
          }
          const routeUnchanged = existing
            && existing.milvusProfileId === route.milvusProfileId
            && existing.collection === route.collection
            && existing.textField === route.textField
            && existing.sparseField === route.sparseField
          const rerank = draft.rerank.strategy === 'weighted'
            ? {
                strategy: 'weighted',
                denseWeight: Number(draft.rerank.denseWeight),
                bm25Weight: Number(draft.rerank.bm25Weight),
              }
            : { strategy: 'rrf', k: Number(draft.rerank.k) }
          const policy = {
            ...route,
            ...(draft.schemaFingerprint
              ? { schemaFingerprint: draft.schemaFingerprint }
              : routeUnchanged && existing.schemaFingerprint
                ? { schemaFingerprint: existing.schemaFingerprint }
                : {}),
            rerank,
          }
          const retrievalPolicies = originalKey
            ? current.retrievalPolicies.map((item) => policyKey(item) === originalKey ? policy : item)
            : [...current.retrievalPolicies, policy]
          await this.scope.set('retrievalPolicies', retrievalPolicies)
          return policy
        })
      }

      removeRetrievalPolicy(key) {
        return this.run(async () => {
          const current = this.getSnapshot()
          await this.scope.set('retrievalPolicies', current.retrievalPolicies.filter((policy) => policyKey(policy) !== key))
        })
      }

      writeCredential(profile, value) {
        if (!profile.credentialRef || !value) return Promise.resolve(false)
        return this.run(async () => {
          await this.api.credentials.set({ ref: profile.credentialRef, value })
          await this.readCredentials([profile.credentialRef])
          return this.credentials[profile.credentialRef]?.configured === true
        })
      }

      configureSemantic({ milvusProfileId, collection, vectorField, embeddingProfileId, provider, model, apiKey }) {
        return this.run(async () => {
          const current = this.getSnapshot()
          let embeddingProfile = current.embeddingProfiles.find((item) => item.id === embeddingProfileId)
          if (!embeddingProfile) {
            const identity = nextEmbeddingIdentity(provider, current.embeddingProfiles)
            embeddingProfile = {
              ...identity,
              provider,
              model,
              credentialRef: embeddingCredentialRefFor(provider, identity.id),
            }
          }
          const credential = current.credentials[embeddingProfile.credentialRef]
          if (!credential?.configured && !apiKey) throw new Error('Enter an API key to enable semantic search.')
          if (apiKey) await this.api.credentials.set({ ref: embeddingProfile.credentialRef, value: apiKey })

          if (!current.embeddingProfiles.some((item) => item.id === embeddingProfile.id)) {
            await this.scope.set('embeddingProfiles', [...current.embeddingProfiles, embeddingProfile])
          }
          const binding = { milvusProfileId, collection, vectorField, embeddingProfileId: embeddingProfile.id }
          const retrievalBindings = [
            ...current.retrievalBindings.filter((item) => item.milvusProfileId !== milvusProfileId || item.collection !== collection),
            binding,
          ]
          await this.scope.set('retrievalBindings', retrievalBindings)
          await this.readCredentials([embeddingProfile.credentialRef])
          return { embeddingProfile, binding }
        })
      }

      requestCheck(profile) {
        return this.run(() => this.statusScope.set('request', {
          profileId: profile.id,
          requestId: this.nextRequestId(),
        }))
      }

      requestEmbeddingCheck(profile) {
        return this.run(() => this.statusScope.set('embeddingRequest', {
          profileId: profile.id,
          requestId: this.nextRequestId(),
        }))
      }

      requestCollectionDiscovery(profile, collection) {
        return this.run(() => this.statusScope.set('collectionRequest', {
          profileId: profile.id,
          ...(collection ? { collection } : {}),
          requestId: this.nextRequestId(),
        }))
      }

      refreshCredential(ref) {
        const state = this.getSnapshot()
        if ([...state.profiles, ...state.embeddingProfiles].some((profile) => profile.credentialRef === ref)) this.readCredentials()
      }
    }

    function Field({ label, hint, children }) {
      return h('label', { className: 'dsh-milvus-field' }, [
        h('span', { className: 'dsh-milvus-label', key: 'label' }, label),
        children,
        hint ? h('span', { className: 'dsh-milvus-hint', key: 'hint' }, hint) : null,
      ])
    }

    function StatusPill({ state, children }) {
      return h('span', { className: 'dsh-milvus-pill', 'data-state': state }, children)
    }

    function CapabilityRow({ state, title, detail, action }) {
      const symbol = state === 'ready' ? '✓' : state === 'ambiguous' ? '!' : '○'
      return h('div', { className: 'dsh-milvus-capability', 'data-state': state }, [
        h('span', { className: 'dsh-milvus-capability-icon', key: 'icon' }, symbol),
        h('div', { className: 'dsh-milvus-capability-copy', key: 'copy' }, [
          h('strong', { key: 'title' }, title),
          h('span', { key: 'detail' }, detail),
        ]),
        action ? h('div', { className: 'dsh-milvus-capability-action', key: 'action' }, action) : null,
      ])
    }

    function MilvusSettingsCard({ controller }) {
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      const initialProfileId = state.activeProfileId || state.profiles[0]?.id || ''
      const [selectedId, setSelectedId] = React.useState(initialProfileId)
      const selected = state.profiles.find((profile) => profile.id === selectedId)
      const [editingConnection, setEditingConnection] = React.useState(!selected)
      const [draft, setDraft] = React.useState(() => draftOf(selected, state.profiles))
      const [token, setToken] = React.useState('')
      const [selectedCollection, setSelectedCollection] = React.useState('')
      const [showSemantic, setShowSemantic] = React.useState(false)
      const [embeddingChoice, setEmbeddingChoice] = React.useState('new:openai')
      const [embeddingModel, setEmbeddingModel] = React.useState(embeddingDefaults.openai.model)
      const [apiKey, setApiKey] = React.useState('')
      const [vectorField, setVectorField] = React.useState('')
      const [routeKey, setRouteKey] = React.useState('')
      const [rerank, setRerank] = React.useState({ strategy: 'rrf', k: 60 })

      const connectionCheck = selected ? state.checks[selected.id] : undefined
      const collectionCheck = selected ? state.collectionChecks[selected.id] : undefined
      const inspection = collectionCheck?.requestedCollection === selectedCollection
        && collectionCheck.collection?.name === selectedCollection
        ? collectionCheck.collection
        : undefined
      const vectorFields = inspection?.fields.filter((field) => /^floatvector$/i.test(field.dataType)) ?? []
      const bm25Routes = inspection?.retrievalSchema.bm25Routes ?? []
      const bindings = selected && selectedCollection
        ? state.retrievalBindings.filter((binding) => binding.milvusProfileId === selected.id && binding.collection === selectedCollection)
        : []
      const binding = bindings.length === 1 ? bindings[0] : undefined
      const boundEmbedding = binding
        ? state.embeddingProfiles.find((profile) => profile.id === binding.embeddingProfileId)
        : undefined
      const boundCredential = boundEmbedding ? state.credentials[boundEmbedding.credentialRef] : undefined
      const denseStructurallyReady = inspection?.capabilities.dense.state === 'ready'
      const denseReady = denseStructurallyReady && boundCredential?.configured === true
      const bm25Ready = inspection?.capabilities.bm25.state === 'ready'
      const hybridReady = denseReady && bm25Ready
      const currentPolicy = selected && selectedCollection
        ? state.retrievalPolicies.find((policy) => policy.milvusProfileId === selected.id && policy.collection === selectedCollection)
        : undefined
      const semanticProfile = embeddingChoice.startsWith('new:')
        ? undefined
        : state.embeddingProfiles.find((profile) => profile.id === embeddingChoice)
      const semanticProvider = semanticProfile?.provider ?? embeddingChoice.slice(4)
      const semanticModels = embeddingModelsFor(semanticProvider)
      const semanticCredential = semanticProfile ? state.credentials[semanticProfile.credentialRef] : undefined
      const semanticKeyRequired = semanticProfile ? semanticCredential?.configured !== true : true
      const chosenRoute = bm25Routes.find((route) => `${route.inputField}\u0000${route.outputField}` === routeKey)
      const rerankValid = rerank.strategy === 'rrf'
        ? Number.isFinite(Number(rerank.k)) && Number(rerank.k) > 0 && Number(rerank.k) < 16_384
        : [rerank.denseWeight, rerank.bm25Weight].every((weight) => Number.isFinite(Number(weight)) && Number(weight) >= 0 && Number(weight) <= 1)
          && !(Number(rerank.denseWeight) === 0 && Number(rerank.bm25Weight) === 0)

      React.useEffect(() => {
        setSelectedCollection('')
        setShowSemantic(false)
        if (selected && !editingConnection) controller.requestCollectionDiscovery(selected)
      }, [selectedId, editingConnection])

      React.useEffect(() => {
        if (!inspection) return
        const policyRoute = currentPolicy
          ? bm25Routes.find((route) => route.inputField === currentPolicy.textField && route.outputField === currentPolicy.sparseField)
          : undefined
        const route = policyRoute ?? bm25Routes[0]
        setRouteKey(route ? `${route.inputField}\u0000${route.outputField}` : '')
        setRerank(currentPolicy?.rerank?.strategy === 'weighted'
          ? {
              strategy: 'weighted',
              denseWeight: currentPolicy.rerank.denseWeight,
              bm25Weight: currentPolicy.rerank.bm25Weight,
            }
          : { strategy: 'rrf', k: currentPolicy?.rerank?.k ?? 60 })
      }, [inspection?.name, inspection?.retrievalSchema.schemaFingerprint, currentPolicy])

      const updateDraft = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }))
      const chooseConnection = (id) => {
        const profile = state.profiles.find((item) => item.id === id)
        setSelectedId(id)
        setDraft(draftOf(profile, state.profiles))
        setToken('')
      }
      const changeKind = (kind) => setDraft(emptyDraft(kind, state.profiles))
      const openSemantic = () => {
        if (boundEmbedding) {
          setEmbeddingChoice(boundEmbedding.id)
          setEmbeddingModel(boundEmbedding.model)
          setVectorField(binding.vectorField)
        } else {
          setEmbeddingChoice('new:openai')
          setEmbeddingModel(embeddingDefaults.openai.model)
          setVectorField(vectorFields[0]?.name ?? '')
        }
        setApiKey('')
        setShowSemantic(true)
      }
      const chooseEmbedding = (value) => {
        setEmbeddingChoice(value)
        const profile = state.embeddingProfiles.find((item) => item.id === value)
        const provider = profile?.provider ?? value.slice(4)
        setEmbeddingModel(profile?.model ?? embeddingDefaults[provider].model)
        setApiKey('')
      }

      const connectionSummary = selected && !editingConnection
        ? h('section', { className: 'dsh-milvus-section', key: 'connection' }, [
            h('div', { className: 'dsh-milvus-heading-row', key: 'heading' }, [
              h('h4', { key: 'title' }, 'Connection'),
              h(StatusPill, { state: connectionCheck?.state ?? 'idle', key: 'pill' }, connectionCheck?.state === 'ready' ? 'Connected' : connectionCheck?.state === 'blocked' ? 'Needs attention' : 'Not tested'),
            ]),
            h('div', { className: 'dsh-milvus-summary', key: 'summary' }, [
              h('strong', { key: 'name' }, selected.name),
              h('span', { key: 'endpoint' }, selected.endpoint),
              h('span', { key: 'database' }, `Database: ${selected.database || 'default'}`),
            ]),
            connectionCheck ? h('p', { className: 'dsh-milvus-hint', key: 'check-message' }, connectionCheck.message) : null,
            h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
              h('button', { type: 'button', disabled: state.pending, onClick: () => controller.requestCheck(selected), key: 'test' }, 'Test connection'),
              h('button', { type: 'button', disabled: state.pending, onClick: () => { setDraft(draftOf(selected, state.profiles)); setEditingConnection(true) }, key: 'change' }, 'Change connection'),
              state.activeProfileId !== selected.id
                ? h('button', { type: 'button', disabled: state.pending, onClick: () => controller.selectProfile(selected.id), key: 'active' }, 'Use for new sessions')
                : null,
            ]),
          ])
        : h('section', { className: 'dsh-milvus-section', key: 'connection-form' }, [
            h('h4', { key: 'title' }, 'Connection'),
            state.profiles.length ? h(Field, { label: 'Saved connection', key: 'saved' }, h('select', { value: selectedId, disabled: state.pending, onChange: (event) => chooseConnection(event.target.value) }, [
              h('option', { value: '', key: 'new' }, 'Add another connection'),
              ...state.profiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)),
            ])) : null,
            h('div', { className: 'dsh-milvus-grid', key: 'grid' }, [
              h(Field, { label: 'Deployment', key: 'kind' }, h('select', { value: draft.kind, disabled: state.pending || Boolean(selected), onChange: (event) => changeKind(event.target.value) }, [
                h('option', { value: 'local', key: 'local' }, 'Local Milvus Standalone'),
                h('option', { value: 'zilliz-cloud', key: 'cloud' }, 'Zilliz Cloud'),
              ])),
              h(Field, { label: 'Database (optional)', key: 'database' }, h('input', { value: draft.database, disabled: state.pending, onChange: (event) => updateDraft('database', event.target.value) })),
            ]),
            h(Field, { label: 'Endpoint', hint: draft.kind === 'zilliz-cloud' ? 'Zilliz Cloud requires HTTPS.' : 'Example: http://127.0.0.1:19530', key: 'endpoint' }, h('input', { value: draft.endpoint, disabled: state.pending, onChange: (event) => updateDraft('endpoint', event.target.value) })),
            draft.kind === 'local' && !draft.credentialRef
              ? h('button', { type: 'button', className: 'dsh-milvus-link-button', disabled: state.pending, onClick: () => updateDraft('credentialRef', credentialRefFor(draft.id || 'local')), key: 'auth' }, 'Add optional authentication')
              : null,
            draft.credentialRef ? h(Field, { label: 'Milvus token', hint: 'Saved only in dsh Credentials. Existing values are never displayed.', key: 'token' }, h('input', { type: 'password', autoComplete: 'new-password', value: token, disabled: state.pending, onChange: (event) => setToken(event.target.value) })) : null,
            h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
              h('button', { type: 'button', disabled: state.pending || !draft.endpoint.trim() || (!selected && Boolean(draft.credentialRef) && !token), onClick: async () => {
                if (!selected && draft.credentialRef && !await controller.writeCredential(draft, token)) return
                const saved = await controller.saveProfile(draft, selected?.id)
                if (!saved) return
                if (selected && token) await controller.writeCredential(saved, token)
                setSelectedId(saved.id)
                setToken('')
                setEditingConnection(false)
              }, key: 'save' }, selected ? 'Save connection' : 'Connect Milvus'),
              selected ? h('button', { type: 'button', disabled: state.pending, onClick: () => setEditingConnection(false), key: 'cancel' }, 'Cancel') : null,
            ]),
          ])

      const collectionSection = selected && !editingConnection
        ? h('section', { className: 'dsh-milvus-section', key: 'collection' }, [
            h('div', { className: 'dsh-milvus-heading-row', key: 'heading' }, [
              h('h4', { key: 'title' }, 'Collection'),
              collectionCheck ? h(StatusPill, { state: collectionCheck.state, key: 'pill' }, collectionCheck.state === 'ready'
                ? collectionCheck.requestedCollection ? 'Inspected by DSH' : 'Collections loaded'
                : 'Could not inspect') : null,
            ]),
            h('p', { className: 'dsh-milvus-hint', key: 'hint' }, 'Choose a collection to see what search already works. Fields and routes come from its Milvus schema.'),
            h('div', { className: 'dsh-milvus-row', key: 'chooser' }, [
              h('select', { className: 'dsh-milvus-grow', value: selectedCollection, disabled: state.pending || !collectionCheck?.collections?.length, onChange: (event) => {
                const name = event.target.value
                setSelectedCollection(name)
                setShowSemantic(false)
                if (name) controller.requestCollectionDiscovery(selected, name)
              }, key: 'select' }, [
                h('option', { value: '', key: 'none' }, collectionCheck ? 'Select a collection' : 'Loading collections…'),
                ...(collectionCheck?.collections ?? []).map((name) => h('option', { value: name, key: name }, name)),
              ]),
              h('button', { type: 'button', disabled: state.pending, onClick: () => controller.requestCollectionDiscovery(selected, selectedCollection || undefined), key: 'refresh' }, selectedCollection ? 'Inspect again' : 'Refresh'),
            ]),
            collectionCheck ? h('p', { className: `dsh-milvus-hint${collectionCheck.state === 'blocked' ? ' dsh-milvus-error' : ''}`, key: 'status' }, collectionCheck.message) : null,
          ])
        : null

      const semanticSetup = showSemantic && inspection
        ? h('div', { className: 'dsh-milvus-subpanel', key: 'semantic-setup' }, [
            h('div', { className: 'dsh-milvus-heading-row', key: 'heading' }, [
              h('div', { key: 'copy' }, [
                h('strong', { key: 'title' }, denseReady ? 'Change semantic search' : 'Enable semantic search'),
                h('p', { className: 'dsh-milvus-hint', key: 'hint' }, 'DSH embeds query text on the Host. The generated vector stays in memory and is sent only to Milvus.'),
              ]),
              h('button', { type: 'button', disabled: state.pending, onClick: () => setShowSemantic(false), key: 'close' }, 'Close'),
            ]),
            h('div', { className: 'dsh-milvus-grid', key: 'provider-row' }, [
              h(Field, { label: 'Embedding provider', key: 'provider' }, h('select', { value: embeddingChoice, disabled: state.pending, onChange: (event) => chooseEmbedding(event.target.value) }, [
                h('option', { value: 'new:openai', key: 'new-openai' }, 'New OpenAI provider'),
                h('option', { value: 'new:gemini', key: 'new-gemini' }, 'New Google Gemini provider'),
                ...state.embeddingProfiles.map((profile) => h('option', { value: profile.id, key: profile.id }, `Use ${profile.name} · ${profile.model}`)),
              ])),
              h(Field, { label: 'Model', key: 'model' }, h('select', { value: semanticProfile?.model ?? embeddingModel, disabled: state.pending || Boolean(semanticProfile), onChange: (event) => setEmbeddingModel(event.target.value) }, semanticModels.map((model) => h('option', { value: model, key: model }, model)))),
            ]),
            h('div', { className: 'dsh-milvus-grid', key: 'binding-row' }, [
              h(Field, { label: `${semanticProvider === 'gemini' ? 'Gemini' : 'OpenAI'} API key`, hint: semanticProfile && !semanticKeyRequired ? 'Already configured. Leave empty to keep it.' : 'Required. Saved only in dsh Credentials.', key: 'key' }, h('input', { type: 'password', autoComplete: 'new-password', value: apiKey, disabled: state.pending || semanticCredential?.writable === false, onChange: (event) => setApiKey(event.target.value) })),
              h(Field, { label: 'Vector field', hint: 'Choose the field populated with this exact embedding model.', key: 'vector' }, h('select', { value: vectorField, disabled: state.pending || !vectorFields.length, onChange: (event) => setVectorField(event.target.value) }, [
                h('option', { value: '', key: 'none' }, vectorFields.length ? 'Select a FloatVector field' : 'No FloatVector field found'),
                ...vectorFields.map((field) => h('option', { value: field.name, key: field.name }, `${field.name}${field.dimension ? ` · ${field.dimension} dimensions` : ''}`)),
              ])),
            ]),
            !vectorFields.length ? h('p', { className: 'dsh-milvus-error', key: 'no-vector' }, 'This collection has no FloatVector field, so semantic search cannot be enabled here.') : null,
            h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
              h('button', { type: 'button', disabled: state.pending || !vectorField || (semanticKeyRequired && !apiKey), onClick: async () => {
                const result = await controller.configureSemantic({
                  milvusProfileId: selected.id,
                  collection: selectedCollection,
                  vectorField,
                  embeddingProfileId: semanticProfile?.id,
                  provider: semanticProvider,
                  model: semanticProfile?.model ?? embeddingModel,
                  apiKey,
                })
                if (!result) return
                setApiKey('')
                setShowSemantic(false)
                controller.requestCollectionDiscovery(selected, selectedCollection)
              }, key: 'save' }, denseReady ? 'Save semantic setup' : 'Enable semantic search'),
              semanticProfile ? h('button', { type: 'button', disabled: state.pending || semanticKeyRequired, onClick: () => controller.requestEmbeddingCheck(semanticProfile), key: 'test' }, 'Test provider') : null,
            ]),
            semanticProfile && state.embeddingChecks[semanticProfile.id]
              ? h('p', { className: 'dsh-milvus-hint', key: 'provider-status' }, state.embeddingChecks[semanticProfile.id].message)
              : null,
          ])
        : null

      const capabilitiesSection = inspection
        ? h('section', { className: 'dsh-milvus-section', key: 'capabilities' }, [
            h('h4', { key: 'title' }, 'Search capabilities'),
            h('div', { className: 'dsh-milvus-capabilities', key: 'rows' }, [
              h(CapabilityRow, { state: 'ready', title: 'Scalar query', detail: 'Ready · filter and return scalar fields', key: 'scalar' }),
              h(CapabilityRow, {
                state: inspection.capabilities.bm25.state,
                title: 'BM25 search',
                detail: bm25Ready
                  ? `${inspection.capabilities.bm25.routes[0].inputField} → ${inspection.capabilities.bm25.routes[0].outputField}`
                  : inspection.capabilities.bm25.state === 'ambiguous'
                    ? 'Choose one valid route in Advanced settings'
                    : 'No schema-proven Milvus BM25 route',
                key: 'bm25',
              }),
              h(CapabilityRow, {
                state: denseReady ? 'ready' : inspection.capabilities.dense.state === 'ambiguous' ? 'ambiguous' : 'blocked',
                title: 'Semantic search',
                detail: denseReady
                  ? `${boundEmbedding.model} → ${binding.vectorField}`
                  : denseStructurallyReady
                    ? 'Embedding API key required'
                    : 'Add an embedding provider and vector-field mapping',
                action: h('button', { type: 'button', disabled: state.pending || !vectorFields.length, onClick: openSemantic }, denseReady ? 'Change' : 'Enable'),
                key: 'dense',
              }),
              h(CapabilityRow, {
                state: hybridReady ? 'ready' : 'blocked',
                title: 'Hybrid search',
                detail: hybridReady
                  ? `${bm25Ready ? 'BM25' : ''} + semantic · ${currentPolicy?.rerank?.strategy === 'weighted' ? 'Weighted' : `RRF (k=${currentPolicy?.rerank?.k ?? 60})`}`
                  : !bm25Ready
                    ? 'Requires a valid BM25 route and semantic search'
                    : 'Enable semantic search first',
                key: 'hybrid',
              }),
            ]),
            semanticSetup,
          ])
        : null

      const advanced = selected && !editingConnection
        ? h('details', { className: 'dsh-milvus-advanced', key: 'advanced' }, [
            h('summary', { key: 'summary' }, [
              h('strong', { key: 'title' }, 'Advanced settings'),
              h('span', { key: 'hint' }, 'Mappings, BM25 route, and hybrid ranking'),
            ]),
            inspection ? h('div', { className: 'dsh-milvus-advanced-body', key: 'body' }, [
              h('div', { className: 'dsh-milvus-subsection', key: 'mapping' }, [
                h('h5', { key: 'title' }, 'Vector field mapping'),
                binding && boundEmbedding
                  ? h('div', { className: 'dsh-milvus-summary dsh-milvus-summary-inline', key: 'configured' }, [
                      h('span', { key: 'value' }, `${binding.vectorField} ← ${boundEmbedding.name} (${boundEmbedding.model})`),
                      h('button', { type: 'button', disabled: state.pending, onClick: async () => {
                        await controller.removeRetrievalBinding(bindingKey(binding))
                        controller.requestCollectionDiscovery(selected, selectedCollection)
                      }, key: 'remove' }, 'Remove mapping'),
                    ])
                  : h('p', { className: 'dsh-milvus-hint', key: 'empty' }, 'No semantic mapping for this collection.'),
              ]),
              h('div', { className: 'dsh-milvus-subsection', key: 'policy' }, [
                h('h5', { key: 'title' }, 'BM25 route and hybrid ranking'),
                bm25Routes.length ? h('div', { key: 'form' }, [
                  h(Field, { label: 'BM25 route', hint: bm25Routes.length === 1 ? 'The collection exposes one valid route; no override is normally needed.' : 'Choose which schema-proven route hybrid and text search should use.', key: 'route' }, h('select', { value: routeKey, disabled: state.pending, onChange: (event) => setRouteKey(event.target.value) }, bm25Routes.map((route) => h('option', { value: `${route.inputField}\u0000${route.outputField}`, key: `${route.inputField}\u0000${route.outputField}` }, `${route.inputField} → ${route.outputField}`)))),
                  h(Field, { label: 'Default hybrid ranking', key: 'strategy' }, h('select', { value: rerank.strategy, disabled: state.pending, onChange: (event) => setRerank(event.target.value === 'weighted' ? { strategy: 'weighted', denseWeight: 0.5, bm25Weight: 0.5 } : { strategy: 'rrf', k: 60 }) }, [
                    h('option', { value: 'rrf', key: 'rrf' }, 'RRF (recommended)'),
                    h('option', { value: 'weighted', key: 'weighted' }, 'Weighted'),
                  ])),
                  rerank.strategy === 'weighted'
                    ? h('div', { className: 'dsh-milvus-grid', key: 'weights' }, [
                        h(Field, { label: 'Semantic weight', key: 'dense' }, h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: rerank.denseWeight, disabled: state.pending, onChange: (event) => setRerank((previous) => ({ ...previous, denseWeight: event.target.value })) })),
                        h(Field, { label: 'BM25 weight', key: 'bm25' }, h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: rerank.bm25Weight, disabled: state.pending, onChange: (event) => setRerank((previous) => ({ ...previous, bm25Weight: event.target.value })) })),
                      ])
                    : h(Field, { label: 'RRF k', key: 'k' }, h('input', { type: 'number', min: 1, max: 16383, step: 1, value: rerank.k, disabled: state.pending, onChange: (event) => setRerank((previous) => ({ ...previous, k: event.target.value })) })),
                  h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
                    h('button', { type: 'button', disabled: state.pending || !chosenRoute || !rerankValid, onClick: async () => {
                      const saved = await controller.saveRetrievalPolicy({
                        milvusProfileId: selected.id,
                        collection: selectedCollection,
                        textField: chosenRoute.inputField,
                        sparseField: chosenRoute.outputField,
                        schemaFingerprint: inspection.retrievalSchema.schemaFingerprint,
                        rerank,
                      }, currentPolicy ? policyKey(currentPolicy) : undefined)
                      if (saved) controller.requestCollectionDiscovery(selected, selectedCollection)
                    }, key: 'save' }, currentPolicy ? 'Save advanced defaults' : 'Create advanced defaults'),
                    currentPolicy ? h('button', { type: 'button', disabled: state.pending, onClick: async () => {
                      await controller.removeRetrievalPolicy(policyKey(currentPolicy))
                      controller.requestCollectionDiscovery(selected, selectedCollection)
                    }, key: 'remove' }, 'Restore automatic defaults') : null,
                  ]),
                ]) : h('p', { className: 'dsh-milvus-hint', key: 'empty' }, 'This collection has no schema-proven BM25 route, so there is no route or hybrid ranking to configure.'),
              ]),
            ]) : h('p', { className: 'dsh-milvus-hint dsh-milvus-advanced-empty', key: 'choose' }, 'Select and inspect a collection to configure collection-specific settings.'),
            h('div', { className: 'dsh-milvus-subsection dsh-milvus-danger', key: 'connection' }, [
              h('h5', { key: 'title' }, 'Connection management'),
              state.profiles.length > 1 ? h(Field, { label: 'Current connection', key: 'switch' }, h('select', { value: selectedId, disabled: state.pending, onChange: (event) => chooseConnection(event.target.value) }, state.profiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)))) : null,
              h('button', { type: 'button', disabled: state.pending, onClick: async () => {
                if (!(globalThis.confirm?.(`Remove ${selected.name} and its collection mappings?`) ?? true)) return
                await controller.removeProfile(selected.id)
                const nextId = controller.getSnapshot().activeProfileId || controller.getSnapshot().profiles[0]?.id || ''
                chooseConnection(nextId)
                setEditingConnection(!nextId)
              }, key: 'remove' }, 'Remove connection'),
            ]),
          ])
        : null

      return h('li', { className: 'dsh-milvus-card' }, [
        h('h3', { key: 'title' }, 'Milvus for DSH'),
        h('p', { className: 'dsh-milvus-intro', key: 'intro' }, 'Connect Milvus, choose a collection, and DSH will show what already works. Embedding setup appears only when you enable semantic search.'),
        state.error ? h('p', { role: 'alert', className: 'dsh-milvus-error', key: 'error' }, state.error) : null,
        connectionSummary,
        collectionSection,
        capabilitiesSection,
        advanced,
      ])
    }

    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-milvus'
        tag.textContent = '.dsh-milvus-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:10px;padding:18px}.dsh-milvus-card h3{margin:0}.dsh-milvus-card h4{margin:0}.dsh-milvus-card h5{font-size:13px;margin:0 0 8px}.dsh-milvus-intro,.dsh-milvus-hint{color:var(--dsw-alias-label-tertiary,#666);font-size:12px;line-height:1.5}.dsh-milvus-section{border-top:1px solid var(--dsw-alias-border-l2,#ddd);margin-top:18px;padding-top:16px}.dsh-milvus-heading-row{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dsh-milvus-summary{display:flex;flex-direction:column;gap:3px;margin-top:10px;font-size:13px}.dsh-milvus-summary span{color:var(--dsw-alias-label-tertiary,#666)}.dsh-milvus-summary-inline{align-items:center;flex-direction:row;justify-content:space-between}.dsh-milvus-pill{border-radius:999px;background:var(--dsw-alias-bg-layer-2,#eee);font-size:11px;padding:3px 8px}.dsh-milvus-pill[data-state=ready]{background:#e7f7ed;color:#15703d}.dsh-milvus-pill[data-state=blocked]{background:#fdecec;color:#b42318}.dsh-milvus-field{display:flex;flex-direction:column;gap:5px;margin-top:12px}.dsh-milvus-label{font-size:13px;font-weight:600}.dsh-milvus-field input,.dsh-milvus-field select,.dsh-milvus-row>select{box-sizing:border-box;width:100%;padding:8px;border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:6px;background:transparent;color:inherit}.dsh-milvus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.dsh-milvus-row{display:flex;gap:8px;align-items:center}.dsh-milvus-grow{flex:1}.dsh-milvus-actions{margin-top:14px;flex-wrap:wrap}.dsh-milvus-card button{padding:7px 10px}.dsh-milvus-link-button{margin-top:12px}.dsh-milvus-error{color:#b42318;font-size:13px}.dsh-milvus-capabilities{display:flex;flex-direction:column;margin-top:10px}.dsh-milvus-capability{display:grid;grid-template-columns:24px 1fr auto;align-items:center;gap:8px;border-top:1px solid var(--dsw-alias-border-l2,#eee);padding:11px 2px}.dsh-milvus-capability:first-child{border-top:0}.dsh-milvus-capability-icon{font-weight:700;text-align:center}.dsh-milvus-capability[data-state=ready] .dsh-milvus-capability-icon{color:#15703d}.dsh-milvus-capability[data-state=ambiguous] .dsh-milvus-capability-icon{color:#b25e09}.dsh-milvus-capability-copy{display:flex;flex-direction:column;font-size:13px}.dsh-milvus-capability-copy span{color:var(--dsw-alias-label-tertiary,#666);font-size:12px;margin-top:2px}.dsh-milvus-subpanel{border:1px solid var(--dsw-alias-border-l2,#ddd);border-radius:8px;margin-top:12px;padding:14px}.dsh-milvus-advanced{border-top:1px solid var(--dsw-alias-border-l2,#ddd);margin-top:18px;padding-top:14px}.dsh-milvus-advanced>summary{cursor:pointer;display:flex;flex-direction:column;font-size:13px;list-style-position:inside}.dsh-milvus-advanced>summary span{color:var(--dsw-alias-label-tertiary,#666);font-size:11px;font-weight:400;margin-top:2px}.dsh-milvus-advanced-body{margin-top:12px}.dsh-milvus-advanced-empty{margin:12px 0}.dsh-milvus-subsection{border-top:1px solid var(--dsw-alias-border-l2,#eee);padding-top:14px;margin-top:14px}.dsh-milvus-danger{margin-bottom:2px}@media(max-width:600px){.dsh-milvus-grid{grid-template-columns:1fr}.dsh-milvus-capability{grid-template-columns:22px 1fr}.dsh-milvus-capability-action{grid-column:2}.dsh-milvus-summary-inline{align-items:flex-start;flex-direction:column}}'
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'dsh-milvus: settings card styles')
    }

    return {
      name: 'dsh-milvus',
      inject: ['slots', 'connection', 'remote', 'settingsScope'],
      apply(ctx) {
        const controller = new MilvusProfileController(
          ctx.settingsScope.bind({ namespace: SETTINGS_NAMESPACE }),
          ctx.settingsScope.bind({ namespace: STATUS_NAMESPACE }),
          ctx.get('connection').api,
        )
        installStyles(ctx)
        ctx.effect(() => ctx.remote.$on('credentials/updated', (ref) => controller.refreshCredential(ref)), 'dsh-milvus: credential status refresh')
        ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
          name: 'settings.plugin.item', id: 'dsh-milvus', key: 'dsh-milvus', inject: () => ({ controller }),
        }, MilvusSettingsCard))
      },
    }
  },
})
