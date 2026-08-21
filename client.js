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
    const embeddingDraftOf = (profile, profiles = []) => profile
      ? { ...emptyEmbeddingDraft(profile.provider, profiles), ...profile }
      : emptyEmbeddingDraft('openai', profiles)
    const bindingKey = (binding) => [binding.milvusProfileId, binding.collection, binding.vectorField].join('\u0000')
    const emptyBindingDraft = (state) => ({
      milvusProfileId: state.activeProfileId || state.profiles[0]?.id || '',
      collection: '',
      vectorField: '',
      embeddingProfileId: state.embeddingProfiles[0]?.id || '',
    })
    const policyKey = (policy) => [policy.milvusProfileId, policy.collection].join('\u0000')
    const emptyPolicyDraft = (state) => ({
      milvusProfileId: state.activeProfileId || state.profiles[0]?.id || '',
      collection: '',
      textField: '',
      sparseField: '',
      rerank: { strategy: 'rrf', k: 60 },
    })
    const policyDraftOf = (policy, state) => policy
      ? {
          milvusProfileId: policy.milvusProfileId,
          collection: policy.collection,
          textField: policy.textField,
          sparseField: policy.sparseField,
          rerank: policy.rerank?.strategy === 'weighted'
            ? { strategy: 'weighted', denseWeight: policy.rerank.denseWeight, bm25Weight: policy.rerank.bm25Weight }
            : { strategy: 'rrf', k: policy.rerank?.k ?? 60 },
          ...(policy.schemaFingerprint ? { schemaFingerprint: policy.schemaFingerprint } : {}),
        }
      : emptyPolicyDraft(state)
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
          // A status read must not clear a profile or claim its secret is absent.
        }
      }

      async run(work) {
        this.error = ''
        this.pending = true
        this.emit()
        try {
          return await work()
        } catch (error) {
          this.error = error instanceof Error ? error.message : 'Could not update the Milvus profile.'
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
          ? { id: String(draft.id).trim(), name: String(draft.name).trim() }
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
          // Return the exact persisted shape. The settings subscription reaches
          // React asynchronously, so callers must not reconstruct a new
          // profile from their pre-save snapshot.
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
          // Preserve cross-field validity throughout the two separate writes.
          if (retrievalBindings.length !== current.retrievalBindings.length) {
            await this.scope.set('retrievalBindings', retrievalBindings)
          }
          if (retrievalPolicies.length !== current.retrievalPolicies.length) {
            await this.scope.set('retrievalPolicies', retrievalPolicies)
          }
          if (nextActive !== current.activeProfileId) await this.scope.set('activeProfileId', nextActive)
          await this.scope.set('profiles', profiles)
        })
      }

      async saveEmbeddingProfile(draft, originalId) {
        const current = this.getSnapshot()
        const existing = current.embeddingProfiles.find((item) => item.id === originalId)
        const identity = existing
          ? { id: String(draft.id).trim(), name: String(draft.name).trim() }
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
          if (retrievalBindings.length !== current.retrievalBindings.length) {
            await this.scope.set('retrievalBindings', retrievalBindings)
          }
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
            ...(routeUnchanged && existing.schemaFingerprint ? { schemaFingerprint: existing.schemaFingerprint } : {}),
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

      requestCheck(profile) {
        return this.run(() => this.statusScope.set('request', {
          profileId: profile.id,
          requestId: Date.now(),
        }))
      }

      requestEmbeddingCheck(profile) {
        return this.run(() => this.statusScope.set('embeddingRequest', {
          profileId: profile.id,
          requestId: Date.now(),
        }))
      }

      refreshCredential(ref) {
        const state = this.getSnapshot()
        if ([...state.profiles, ...state.embeddingProfiles].some((profile) => profile.credentialRef === ref)) this.readCredentials()
      }
    }

    function Field({ label, hint, children }) {
      return h('label', { className: 'dsh-milvus-field' }, [
        h('span', { className: 'dsh-milvus-label', key: 'label' }, label), children,
        hint ? h('span', { className: 'dsh-milvus-hint', key: 'hint' }, hint) : null,
      ])
    }

    function MilvusSettingsCard({ controller }) {
      const state = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot)
      const [selectedId, setSelectedId] = React.useState(state.activeProfileId)
      const [draft, setDraft] = React.useState(() => draftOf(state.profiles.find((profile) => profile.id === state.activeProfileId), state.profiles))
      const [token, setToken] = React.useState('')
      const [selectedEmbeddingId, setSelectedEmbeddingId] = React.useState('')
      const [embeddingDraft, setEmbeddingDraft] = React.useState(() => emptyEmbeddingDraft('openai', state.embeddingProfiles))
      const [apiKey, setApiKey] = React.useState('')
      const [selectedBindingKey, setSelectedBindingKey] = React.useState('')
      const [bindingDraft, setBindingDraft] = React.useState(() => emptyBindingDraft(state))
      const [selectedPolicyKey, setSelectedPolicyKey] = React.useState('')
      const [policyDraft, setPolicyDraft] = React.useState(() => emptyPolicyDraft(state))

      const selected = state.profiles.find((profile) => profile.id === selectedId)
      const selectedEmbedding = state.embeddingProfiles.find((profile) => profile.id === selectedEmbeddingId)
      const selectedBinding = state.retrievalBindings.find((binding) => bindingKey(binding) === selectedBindingKey)
      const selectedPolicy = state.retrievalPolicies.find((policy) => policyKey(policy) === selectedPolicyKey)
      const update = (field, value) => setDraft((previous) => ({ ...previous, [field]: value }))
      const updateKind = (kind) => setDraft((previous) => selected ? { ...previous, kind } : emptyDraft(kind, state.profiles))
      const choose = (id, profile) => {
        setSelectedId(id)
        setDraft(draftOf(profile ?? state.profiles.find((item) => item.id === id), state.profiles))
        setToken('')
      }
      const chooseEmbedding = (id, profile) => {
        setSelectedEmbeddingId(id)
        setEmbeddingDraft(embeddingDraftOf(profile ?? state.embeddingProfiles.find((item) => item.id === id), state.embeddingProfiles))
        setApiKey('')
      }
      const chooseEmbeddingProvider = (provider) => setEmbeddingDraft(emptyEmbeddingDraft(provider, state.embeddingProfiles))
      const chooseBinding = (key, binding) => {
        setSelectedBindingKey(key)
        setBindingDraft(binding ?? state.retrievalBindings.find((item) => bindingKey(item) === key) ?? emptyBindingDraft(state))
      }
      const updateBinding = (field, value) => setBindingDraft((previous) => ({ ...previous, [field]: value }))
      const choosePolicy = (key, policy) => {
        setSelectedPolicyKey(key)
        setPolicyDraft(policyDraftOf(policy ?? state.retrievalPolicies.find((item) => policyKey(item) === key), state))
      }
      const updatePolicy = (field, value) => setPolicyDraft((previous) => ({ ...previous, [field]: value }))
      const updatePolicyRerank = (field, value) => setPolicyDraft((previous) => ({
        ...previous,
        rerank: { ...previous.rerank, [field]: value },
      }))
      const credential = draft.credentialRef ? state.credentials[draft.credentialRef] : undefined
      const embeddingCredential = embeddingDraft.credentialRef ? state.credentials[embeddingDraft.credentialRef] : undefined
      const check = selected ? state.checks[selected.id] : undefined
      const embeddingCheck = selectedEmbedding ? state.embeddingChecks[selectedEmbedding.id] : undefined
      const embeddingModels = embeddingDraft.provider === 'gemini'
        ? ['gemini-embedding-001', 'gemini-embedding-2']
        : ['text-embedding-3-small', 'text-embedding-3-large']
      const policyRerankValid = policyDraft.rerank.strategy === 'rrf'
        ? String(policyDraft.rerank.k).trim()
          && Number.isFinite(Number(policyDraft.rerank.k))
          && Number(policyDraft.rerank.k) > 0
          && Number(policyDraft.rerank.k) < 16_384
        : [policyDraft.rerank.denseWeight, policyDraft.rerank.bm25Weight].every((weight) => String(weight).trim()
            && Number.isFinite(Number(weight))
            && Number(weight) >= 0
            && Number(weight) <= 1)
          && !(Number(policyDraft.rerank.denseWeight) === 0 && Number(policyDraft.rerank.bm25Weight) === 0)

      return h('li', { className: 'dsh-milvus-card' }, [
        h('h3', { key: 'title' }, 'Milvus for DSH'),
        h('p', { className: 'dsh-milvus-intro', key: 'intro' }, 'Connect a Milvus deployment for scalar, BM25, dense, and hybrid retrieval. BM25 uses a compatible collection schema directly; dense and hybrid additionally need an embedding provider and field binding. Secrets are write-only dsh Credentials and are never stored in plugin settings or chat.'),
        state.error ? h('p', { role: 'alert', className: 'dsh-milvus-error', key: 'error' }, state.error) : null,

        h('section', { className: 'dsh-milvus-section', key: 'milvus' }, [
          h('h4', { key: 'heading' }, '1. Milvus deployment'),
          h(Field, { label: 'Profile', key: 'profile' }, h('select', { value: selectedId, disabled: state.pending, onChange: (event) => choose(event.target.value) }, [
            h('option', { value: '', key: 'new' }, 'Create a new profile'),
            ...state.profiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)),
          ])),
          h('div', { className: 'dsh-milvus-grid', key: 'fields' }, [
            h(Field, { label: 'Deployment', hint: selected ? 'Create another profile to use a different deployment type.' : '', key: 'kind' }, h('select', { value: draft.kind, disabled: state.pending || Boolean(selected), onChange: (event) => updateKind(event.target.value) }, [
              h('option', { value: 'local', key: 'local' }, 'Local Milvus Standalone'),
              h('option', { value: 'zilliz-cloud', key: 'cloud' }, 'Zilliz Cloud'),
            ])),
            h(Field, { label: 'Database (optional)', key: 'database' }, h('input', { value: draft.database, disabled: state.pending, onChange: (event) => update('database', event.target.value) })),
          ]),
          h(Field, { label: 'Endpoint', hint: draft.kind === 'zilliz-cloud' ? 'Zilliz Cloud requires HTTPS.' : 'Example: http://127.0.0.1:19530', key: 'endpoint' }, h('input', { value: draft.endpoint, disabled: state.pending, onChange: (event) => update('endpoint', event.target.value) })),
          draft.kind === 'local' && !draft.credentialRef ? h('button', { type: 'button', className: 'dsh-milvus-inline-button', disabled: state.pending, onClick: () => update('credentialRef', credentialRefFor(draft.id || 'local')), key: 'enable-auth' }, 'Add optional Milvus authentication') : null,
          draft.credentialRef ? h(Field, { label: 'Milvus token', hint: selected ? (credential?.configured ? `Configured${credential.source ? ` via ${credential.source}` : ''}${credential.writable ? '' : ' (read-only)'}.` : 'Not configured. A saved value is never shown again.') : 'It will be stored in dsh Credentials when this profile is created.', key: 'token' }, h('div', { className: 'dsh-milvus-row' }, [
            h('input', { type: 'password', autoComplete: 'new-password', value: token, disabled: state.pending || credential?.writable === false, onChange: (event) => setToken(event.target.value), key: 'input' }),
            selected ? h('button', { type: 'button', disabled: state.pending || !token || credential?.writable === false, onClick: async () => { if (await controller.writeCredential(draft, token)) setToken('') }, key: 'save' }, 'Save token') : null,
          ])) : null,
          selected ? h('div', { className: 'dsh-milvus-check', key: 'check' }, [
            h('button', { type: 'button', disabled: state.pending, onClick: () => controller.requestCheck(selected), key: 'button' }, 'Test Milvus connection'),
            check ? h('span', { key: 'status', 'data-state': check.state }, `${check.state}: ${check.message}`) : h('span', { key: 'hint' }, 'Not tested yet.'),
          ]) : null,
          h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
            h('button', { type: 'button', disabled: state.pending || (!selected && Boolean(draft.credentialRef) && !token), onClick: async () => {
              if (!selected && draft.credentialRef) {
                if (!await controller.writeCredential(draft, token)) return
                setToken('')
              }
              const saved = await controller.saveProfile(draft, selectedId || undefined)
              if (saved) choose(saved.id, saved)
            }, key: 'save' }, selected ? 'Save changes' : 'Create profile'),
            selected ? h('button', { type: 'button', disabled: state.pending || state.activeProfileId === selectedId, onClick: () => controller.selectProfile(selectedId), key: 'activate' }, state.activeProfileId === selectedId ? 'Active profile' : 'Use for new sessions') : null,
            selected ? h('button', { type: 'button', disabled: state.pending, onClick: async () => { await controller.removeProfile(selectedId); choose('') }, key: 'remove' }, 'Remove profile') : null,
          ]),
        ]),

        h('section', { className: 'dsh-milvus-section', key: 'embedding' }, [
          h('h4', { key: 'heading' }, '2. Embedding provider'),
          h('p', { className: 'dsh-milvus-hint', key: 'privacy' }, 'Dense-search query text is sent from the DSH host to this provider. The generated vector stays in host memory and is sent only to Milvus.'),
          h(Field, { label: 'Embedding profile', key: 'profile' }, h('select', { value: selectedEmbeddingId, disabled: state.pending, onChange: (event) => chooseEmbedding(event.target.value) }, [
            h('option', { value: '', key: 'new' }, 'Create a new embedding profile'),
            ...state.embeddingProfiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)),
          ])),
          h('div', { className: 'dsh-milvus-grid', key: 'provider-model' }, [
            h(Field, { label: 'Provider', key: 'provider' }, h('select', { value: embeddingDraft.provider, disabled: state.pending || Boolean(selectedEmbedding), onChange: (event) => chooseEmbeddingProvider(event.target.value) }, [
              h('option', { value: 'openai', key: 'openai' }, 'OpenAI'),
              h('option', { value: 'gemini', key: 'gemini' }, 'Google Gemini'),
            ])),
            h(Field, { label: 'Model', key: 'model' }, h('select', { value: embeddingDraft.model, disabled: state.pending, onChange: (event) => setEmbeddingDraft((previous) => ({ ...previous, model: event.target.value })) }, embeddingModels.map((model) => h('option', { value: model, key: model }, model)))),
          ]),
          h(Field, { label: `${embeddingDraft.provider === 'gemini' ? 'Gemini' : 'OpenAI'} API key`, hint: selectedEmbedding ? (embeddingCredential?.configured ? `Configured${embeddingCredential.source ? ` via ${embeddingCredential.source}` : ''}${embeddingCredential.writable ? '' : ' (read-only)'}.` : 'Not configured. Dense search will remain blocked.') : 'Required. The key is saved only in dsh Credentials.', key: 'api-key' }, h('div', { className: 'dsh-milvus-row' }, [
            h('input', { type: 'password', autoComplete: 'new-password', value: apiKey, disabled: state.pending || embeddingCredential?.writable === false, onChange: (event) => setApiKey(event.target.value), key: 'input' }),
            selectedEmbedding ? h('button', { type: 'button', disabled: state.pending || !apiKey || embeddingCredential?.writable === false, onClick: async () => { if (await controller.writeCredential(embeddingDraft, apiKey)) setApiKey('') }, key: 'save' }, 'Save API key') : null,
          ])),
          selectedEmbedding ? h('div', { className: 'dsh-milvus-check', key: 'check' }, [
            h('button', { type: 'button', disabled: state.pending, onClick: () => controller.requestEmbeddingCheck(selectedEmbedding), key: 'button' }, 'Test embedding provider'),
            embeddingCheck ? h('span', { key: 'status', 'data-state': embeddingCheck.state }, `${embeddingCheck.state}: ${embeddingCheck.message}`) : h('span', { key: 'hint' }, 'Not tested yet.'),
          ]) : null,
          h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
            h('button', { type: 'button', disabled: state.pending || (!selectedEmbedding && !apiKey), onClick: async () => {
              if (!selectedEmbedding) {
                if (!await controller.writeCredential(embeddingDraft, apiKey)) return
                setApiKey('')
              }
              const saved = await controller.saveEmbeddingProfile(embeddingDraft, selectedEmbeddingId || undefined)
              if (saved) chooseEmbedding(saved.id, saved)
            }, key: 'save' }, selectedEmbedding ? 'Save embedding profile' : 'Create embedding profile'),
            selectedEmbedding ? h('button', { type: 'button', disabled: state.pending, onClick: async () => { await controller.removeEmbeddingProfile(selectedEmbeddingId); chooseEmbedding('') }, key: 'remove' }, 'Remove embedding profile') : null,
          ]),
        ]),

        h('section', { className: 'dsh-milvus-section', key: 'binding' }, [
          h('h4', { key: 'heading' }, '3. Dense retrieval binding'),
          h('p', { className: 'dsh-milvus-hint', key: 'hint' }, 'Bind the exact FloatVector field that was populated with the same model and vector space. Matching dimensions alone do not make embeddings compatible.'),
          h(Field, { label: 'Binding', key: 'binding-select' }, h('select', { value: selectedBindingKey, disabled: state.pending, onChange: (event) => chooseBinding(event.target.value) }, [
            h('option', { value: '', key: 'new' }, 'Create a new binding'),
            ...state.retrievalBindings.map((binding) => h('option', { value: bindingKey(binding), key: bindingKey(binding) }, `${state.profiles.find((profile) => profile.id === binding.milvusProfileId)?.name ?? binding.milvusProfileId}: ${binding.collection}.${binding.vectorField}`)),
          ])),
          h('div', { className: 'dsh-milvus-grid', key: 'binding-fields-1' }, [
            h(Field, { label: 'Milvus profile', key: 'milvus-profile' }, h('select', { value: bindingDraft.milvusProfileId, disabled: state.pending, onChange: (event) => updateBinding('milvusProfileId', event.target.value) }, [
              h('option', { value: '', key: 'none' }, 'Select a Milvus profile'),
              ...state.profiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)),
            ])),
            h(Field, { label: 'Embedding profile', key: 'embedding-profile' }, h('select', { value: bindingDraft.embeddingProfileId, disabled: state.pending, onChange: (event) => updateBinding('embeddingProfileId', event.target.value) }, [
              h('option', { value: '', key: 'none' }, 'Select an embedding profile'),
              ...state.embeddingProfiles.map((profile) => h('option', { value: profile.id, key: profile.id }, `${profile.name} (${profile.model})`)),
            ])),
          ]),
          h('div', { className: 'dsh-milvus-grid', key: 'binding-fields-2' }, [
            h(Field, { label: 'Collection', key: 'collection' }, h('input', { value: bindingDraft.collection, disabled: state.pending, placeholder: 'documents', onChange: (event) => updateBinding('collection', event.target.value) })),
            h(Field, { label: 'FloatVector field', key: 'vector-field' }, h('input', { value: bindingDraft.vectorField, disabled: state.pending, placeholder: 'embedding', onChange: (event) => updateBinding('vectorField', event.target.value) })),
          ]),
          h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
            h('button', { type: 'button', disabled: state.pending || !bindingDraft.milvusProfileId || !bindingDraft.embeddingProfileId || !bindingDraft.collection.trim() || !bindingDraft.vectorField.trim(), onClick: async () => {
              const saved = await controller.saveRetrievalBinding(bindingDraft, selectedBindingKey || undefined)
              if (saved) chooseBinding(bindingKey(saved), saved)
            }, key: 'save' }, selectedBinding ? 'Save binding' : 'Create binding'),
            selectedBinding ? h('button', { type: 'button', disabled: state.pending, onClick: async () => { await controller.removeRetrievalBinding(selectedBindingKey); chooseBinding('') }, key: 'remove' }, 'Remove binding') : null,
          ]),
        ]),

        h('section', { className: 'dsh-milvus-section', key: 'policy' }, [
          h('h4', { key: 'heading' }, '4. Hybrid defaults (optional)'),
          h('p', { className: 'dsh-milvus-hint', key: 'hint' }, 'Leave this empty when the collection has one BM25 route and the default RRF (k=60) is suitable. Add a policy to choose among multiple BM25 routes or change the default hybrid rerank.'),
          h(Field, { label: 'Collection policy', key: 'policy-select' }, h('select', { value: selectedPolicyKey, disabled: state.pending, onChange: (event) => choosePolicy(event.target.value) }, [
            h('option', { value: '', key: 'new' }, 'Create a new collection policy'),
            ...state.retrievalPolicies.map((policy) => h('option', { value: policyKey(policy), key: policyKey(policy) }, `${state.profiles.find((profile) => profile.id === policy.milvusProfileId)?.name ?? policy.milvusProfileId}: ${policy.collection} (${policy.textField} → ${policy.sparseField})`)),
          ])),
          h('div', { className: 'dsh-milvus-grid', key: 'policy-fields-1' }, [
            h(Field, { label: 'Milvus profile', key: 'milvus-profile' }, h('select', { value: policyDraft.milvusProfileId, disabled: state.pending, onChange: (event) => updatePolicy('milvusProfileId', event.target.value) }, [
              h('option', { value: '', key: 'none' }, 'Select a Milvus profile'),
              ...state.profiles.map((profile) => h('option', { value: profile.id, key: profile.id }, profile.name)),
            ])),
            h(Field, { label: 'Collection', key: 'collection' }, h('input', { value: policyDraft.collection, disabled: state.pending, placeholder: 'documents', onChange: (event) => updatePolicy('collection', event.target.value) })),
          ]),
          h('div', { className: 'dsh-milvus-grid', key: 'policy-fields-2' }, [
            h(Field, { label: 'BM25 text field', key: 'text-field' }, h('input', { value: policyDraft.textField, disabled: state.pending, placeholder: 'text', onChange: (event) => updatePolicy('textField', event.target.value) })),
            h(Field, { label: 'SparseFloatVector field', key: 'sparse-field' }, h('input', { value: policyDraft.sparseField, disabled: state.pending, placeholder: 'sparse', onChange: (event) => updatePolicy('sparseField', event.target.value) })),
          ]),
          h(Field, { label: 'Default hybrid rerank', key: 'rerank-strategy' }, h('select', { value: policyDraft.rerank.strategy, disabled: state.pending, onChange: (event) => setPolicyDraft((previous) => ({
            ...previous,
            rerank: event.target.value === 'weighted'
              ? { strategy: 'weighted', denseWeight: 0.5, bm25Weight: 0.5 }
              : { strategy: 'rrf', k: 60 },
          })) }, [
            h('option', { value: 'rrf', key: 'rrf' }, 'RRF'),
            h('option', { value: 'weighted', key: 'weighted' }, 'Weighted'),
          ])),
          policyDraft.rerank.strategy === 'weighted'
            ? h('div', { className: 'dsh-milvus-grid', key: 'weighted-fields' }, [
                h(Field, { label: 'Dense weight', key: 'dense-weight' }, h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: policyDraft.rerank.denseWeight, disabled: state.pending, onChange: (event) => updatePolicyRerank('denseWeight', event.target.value) })),
                h(Field, { label: 'BM25 weight', key: 'bm25-weight' }, h('input', { type: 'number', min: 0, max: 1, step: 0.05, value: policyDraft.rerank.bm25Weight, disabled: state.pending, onChange: (event) => updatePolicyRerank('bm25Weight', event.target.value) })),
              ])
            : h(Field, { label: 'RRF k', key: 'rrf-k' }, h('input', { type: 'number', min: 0.1, max: 16383, step: 1, value: policyDraft.rerank.k, disabled: state.pending, onChange: (event) => updatePolicyRerank('k', event.target.value) })),
          h('div', { className: 'dsh-milvus-row dsh-milvus-actions', key: 'actions' }, [
            h('button', { type: 'button', disabled: state.pending
              || !policyDraft.milvusProfileId
              || !policyDraft.collection.trim()
              || !policyDraft.textField.trim()
              || !policyDraft.sparseField.trim()
              || !policyRerankValid, onClick: async () => {
              const saved = await controller.saveRetrievalPolicy(policyDraft, selectedPolicyKey || undefined)
              if (saved) choosePolicy(policyKey(saved), saved)
            }, key: 'save' }, selectedPolicy ? 'Save collection policy' : 'Create collection policy'),
            selectedPolicy ? h('button', { type: 'button', disabled: state.pending, onClick: async () => { await controller.removeRetrievalPolicy(selectedPolicyKey); choosePolicy('') }, key: 'remove' }, 'Remove collection policy') : null,
          ]),
        ]),
      ])
    }

    function installStyles(ctx) {
      if (typeof document === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-milvus'
        tag.textContent = '.dsh-milvus-card{list-style:none;border:1px solid var(--dsw-alias-border-l2,#ccc);border-radius:8px;padding:16px}.dsh-milvus-card h3{margin:0}.dsh-milvus-section{border-top:1px solid var(--dsw-alias-border-l2,#ddd);margin-top:18px;padding-top:14px}.dsh-milvus-section h4{margin:0 0 4px}.dsh-milvus-intro,.dsh-milvus-hint{color:var(--dsw-alias-label-tertiary,#666);font-size:12px}.dsh-milvus-field{display:flex;flex-direction:column;gap:5px;margin-top:12px}.dsh-milvus-label{font-size:13px;font-weight:600}.dsh-milvus-field input,.dsh-milvus-field select{box-sizing:border-box;width:100%;padding:7px;border:1px solid var(--dsw-alias-border-l2,#aaa);border-radius:5px;background:transparent;color:inherit}.dsh-milvus-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 12px}.dsh-milvus-row{display:flex;gap:8px;align-items:center}.dsh-milvus-row input{flex:1}.dsh-milvus-actions{margin-top:16px;flex-wrap:wrap}.dsh-milvus-row button,.dsh-milvus-check button,.dsh-milvus-inline-button{padding:7px 10px}.dsh-milvus-inline-button{margin-top:12px}.dsh-milvus-check{display:flex;gap:8px;align-items:center;margin-top:12px;font-size:12px}.dsh-milvus-error{color:#b42318;font-size:13px}@media(max-width:600px){.dsh-milvus-grid{grid-template-columns:1fr}}'
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
